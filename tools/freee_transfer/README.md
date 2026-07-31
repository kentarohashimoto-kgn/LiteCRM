# freee 取引先「振込先口座」インポートCSV生成

請求書(PDF/画像)から振込先口座情報を抽出し、freee の取引先マスタへ取り込む
インポートCSVを生成するパイプライン。最終的なインポート操作は人間が行う。

成果物は2点:

- `output/freee_import.csv` — インポート可能な行のみ
- `output/review.md` — 要確認リスト(原本の参照先つき)

> **このCSVの1文字の誤りが、そのまま誤送金になる。**
> 「30件中24件が確実、6件は要確認」は良い成果物。
> 「30件全部埋まっているが3件間違っている」は最悪の成果物。

---

## 設計の中心にある1つの原則: 推測で埋めない

コード上、これは3つの仕掛けで担保している。

### 1. 自動抽出は `confidence` を `high` にしない

`extract.py`(正規表現)が付けられる確度は `medium` が上限。
`validate.py` は必須項目に `high` を要求する。
つまり **原本を目視した人間/エージェントが `work/extracted.json` を
`high` に更新するまで、値はCSVへ到達しない。**

### 2. 読めなかった文字は落とさず残す

`kana.normalize_kana()` は変換できない文字(漢字・中点など)を削除しない。
`invalid_chars` として報告し、その行は要確認へ回る。
黙って落とすと、それらしいが誤った名義がCSVに載る。

### 3. 類似名は自動で紐付けない

`match.py` が `confirmed` にするのは正規化後の完全一致のみ。
部分一致(「既存商事」と「既存商事ホールディングス」など)は
類似度が低く出ても必ず候補として提示し、確定はしない。
別の取引先へ口座を紐付けると、他社の口座へ送金される。

---

## 使い方

```bash
pip install -r requirements.txt
export PYTHONPATH=/path/to/tools/freee_transfer

# 作業ディレクトリ(input/ work/ output/ の親)で実行する
python -m freee_transfer preflight   # 入力3点の確認。足りなければここで止まる
python -m freee_transfer step1       # freee CSV仕様の確定
python -m freee_transfer step2       # 請求書から候補抽出
#   → work/extracted.json を原本と突き合わせて確認し、確定した項目を high にする
#   → スキャンPDFは work/pages/*.png を見て読み取る
python -m freee_transfer step3       # 名寄せ
#   → work/matching.md の [要確認] を人間が判断し、extracted.json へ反映
python -m freee_transfer build       # 検証と成果物出力
```

### 必要な入力

| 用意するもの | 置き場所 |
|---|---|
| freee からエクスポートした既存の取引先CSV | `input/freee_torihikisaki_export.csv` |
| 請求書ファイル一式(PDF/画像) | `input/invoices/` |
| 支払対象一覧(freee 支払管理レポートの出力) | `input/payment_list.csv` |

`input/` `work/` `output/` は `.gitignore` 済み。口座情報をコミットしないこと。

---

## 各STEPの担当モジュール

| STEP | モジュール | 役割 |
|---|---|---|
| 1 | `freee_export.py` | エクスポート実物からヘッダー・文字コード・記法を取得 |
| 2 | `extract.py` | テキストレイヤー抽出、スキャンページのPNG化、候補抽出 |
| 3 | `match.py` | 取引先の名寄せ(確定/要確認/新規) |
| 4 | `kana.py` | 口座名義カナの全銀フォーマット正規化 |
| 5 | `validate.py` | 全件バリデーション、CSV行と要確認行の振り分け |
| 6 | `build.py` | `freee_import.csv` / `review.md` / `summary.md` の出力 |

### STEP 1 が肝

CSVの列名は **エクスポート実物のヘッダー行が唯一の正解**。
`build.py` は `work/header.txt` からしか列名を取らず、列名を1つも生成しない。

`step1` は列の対応表を `work/column_map.json` に出力する。
候補が複数ある項目もあるので、人間が確認して `"confirmed": true` にするまで
`build` は動かない(暫定確認用に `--allow-unconfirmed`)。

口座種別が freee 側で「普通」でなく「1」などの場合は、
`column_map.json` に値マップを足す:

```json
{
  "confirmed": true,
  "value_maps": { "account_type": { "普通": "1", "当座": "2" } }
}
```

freee 側に口座登録済みの行が0件だと、この記法を実物から学べない。
その場合は **freee で1件だけ手入力して再エクスポートし、STEP 1 をやり直す**。

---

## 実装上の約束

- 口座番号は常に文字列。CSVの読み書きは標準 `csv` モジュール
  (pandas の dtype 推論で先頭ゼロが消える事故を避けるため)
- 出力CSVの文字コードはエクスポート実物に合わせる(freee は Shift_JIS のことがある)
- 中間ファイルは `work/` に残す。デバッグと検算のために消さない
- `step2` は既存の `extracted.json` を上書きしない(`--force` が必要)。
  目視確認済みの内容を消さないための保護

---

## テスト

```bash
python -m unittest discover -s tests -t .
```

`kana` と `validate` は外部依存なしで全件テストされている
(誤送金に直結する部分なので、実データを待たずに検証できるようにしてある)。

---

## 振込後の消込

**freee API に「口座明細と未決済取引を紐づける」エンドポイントはない。**
`/api/1/wallet_txns` は GET / POST / DELETE だけで、既存の明細に取引を当てる操作は
提供されていない。`POST /api/1/deals/{id}/payments` は取引を決済済みにするが、
明細は消込待ちのまま残るため、**同じ支払いが口座に二重計上される**。

したがって消込操作そのものは freee の画面で行う。スクリプトの役割は
「どの取引をどの明細に当てるか」の一覧を作るところまで。

```bash
# freee API のレスポンスを work/ に保存してから
#   work/deals_unsettled.json  GET /api/1/deals?type=expense&status=unsettled
#   work/partners.json         GET /api/1/partners (offset を進めて全件)
PYTHONPATH=. python -m scripts_freee.rebuild_reconcile_plan \
    --due-date 2026-07-31 --deals-total 13182347 --txn-amount 13191419
```

合計が一致する組合せが複数あれば確定せず、候補を出して止まる。
金額の一致は正しさの証明にならない(別の組合せでも帳尻は合う)ので、
どれを外すかは人間が決めて `--exclude` で明示する。

計画は `work/` に出るため実行環境と一緒に消えるが、口座番号を含まないので
このスクリプトで freee から作り直せる。**`work/` の口座情報は作り直せない**
(請求書原本からの抽出をやり直すことになる)。

---

## 次フェーズ(未実装)

freee は振込依頼人コード(委託者コード)の入力を要求するが、
PayPay銀行の WEB総振ではこの項目は不要。
任意の10桁を入れて全銀ファイルを出力し、**出力ファイル側の該当箇所を
スペースに置換する**後処理が必要になる見込み。この変換スクリプトは別タスク。
