"""振込先一覧・要確認リスト・全銀フォーマットファイルを生成する。

方針は一貫して「推測で埋めない」。
必須項目(金融機関コード/支店コード/口座番号/受取人名カナ)が1つでも欠けた行は
全銀ファイルに載せず、要確認へ回す。
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from freee_transfer.kana import MAX_KANA_LENGTH, normalize_kana  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
WORK = BASE / "work"
OUT = BASE / "output"
DUE = "2026-07-31"

# --- 振込元(仕向)口座 -------------------------------------------------------
# 出典: 株式会社顧問名鑑「口座振替のご案内」(receipt 483365597) に記載された
# カトルセの登録預金口座。WEB総振の契約口座と一致するか要確認。
SENDER = {
    "code": "0033", "name": "ﾊﾟｲﾍﾟｲｷﾞﾝｺｳ",
    "branch_code": "005", "branch_name": "ﾋﾞｼﾞﾈｽｴｲｷﾞﾖｳﾌﾞ",
    "account_type": "1", "account_number": "3103228",
    "client_name": "ｶ)ｶﾄﾙｾ",
}
# 委託者コード: PayPay銀行 WEB総振では不要。全10桁スペースで出力する。
CLIENT_CODE = " " * 10

ACCOUNT_TYPE_CODE = {"普通": "1", "当座": "2", "貯蓄": "4"}


def jis_len(text: str) -> int:
    """Shift_JIS でのバイト長(半角カナは1バイト)。"""
    return len(text.encode("cp932"))


def pad(text: str, width: int) -> str:
    """右スペース埋め。超過は切らずに例外にする(黙って切ると別人に振り込む)。"""
    if jis_len(text) > width:
        raise ValueError(f"{text!r} が {width} 桁を超過({jis_len(text)})")
    return text + " " * (width - jis_len(text))


def zfill(value: str, width: int) -> str:
    if len(value) > width:
        raise ValueError(f"{value!r} が {width} 桁を超過")
    return value.rjust(width, "0")


#: 口座情報そのものは揃っていて、人間が「これでよいか」を判断すれば足りる論点。
#: 情報不足(コード欠落など)とは対処が違うので区別する。
JUDGEMENT_ONLY_KEYWORDS = ("決済代行", "重複請求の疑い", "口座振替", "支払期限が2026年8月31日")


def classify(record: dict) -> tuple[str, list[str], str]:
    """確定/要確認を判定し、正規化した受取人名カナを返す。"""
    problems = list(record["issues"])

    # 過去に着金している名義があればそれを正とする。
    # 漢字からの読み生成と違い、実際に振込が成立した実績に基づく確かな根拠。
    if record.get("holder_from_history"):
        kana = normalize_kana(record["holder_from_history"])
    else:
        kana = normalize_kana(record["holder_raw"])
    if not record["holder_raw"] and not record.get("holder_from_history"):
        problems.append("受取人名カナが取得できていない")
    elif kana.invalid_chars:
        problems.append(
            "受取人名に全銀で使えない文字: " + " ".join(repr(c) for c in kana.invalid_chars)
        )
    elif kana.length > MAX_KANA_LENGTH:
        problems.append(f"受取人名カナが{kana.length}文字(上限{MAX_KANA_LENGTH})")

    for field, label in (
        ("bank_code", "金融機関コード"),
        ("branch_code", "支店コード"),
        ("account_number", "口座番号"),
    ):
        if not record[field]:
            if not any(label in p for p in problems):
                problems.append(f"{label}が未確定")
    if record["account_type"] not in ACCOUNT_TYPE_CODE:
        problems.append("口座種別が未確定")

    if record["bank_code"] and not (record["bank_code"].isdigit() and len(record["bank_code"]) == 4):
        problems.append("金融機関コードが4桁の数字でない")
    if record["branch_code"] and not (record["branch_code"].isdigit() and len(record["branch_code"]) == 3):
        problems.append("支店コードが3桁の数字でない")
    if record["account_number"] and not record["account_number"].isdigit():
        problems.append("口座番号に数字以外が含まれる")

    if not problems:
        status = "確定"
    elif all(any(k in p for k in JUDGEMENT_ONLY_KEYWORDS) for p in problems):
        # 口座情報は完備。振り込んでよいかの判断だけが残っている。
        status = "要判断"
    else:
        status = "情報不足"
    return status, problems, kana.normalized


def build_zengin(rows: list[dict]) -> str:
    """全銀フォーマット(総合振込・120桁固定長)を組み立てる。"""
    lines = []

    # ヘッダーレコード
    header = (
        "1" + "21" + "0"
        + CLIENT_CODE
        + pad(SENDER["client_name"], 40)
        + DUE[5:7] + DUE[8:10]
        + SENDER["code"] + pad(SENDER["name"], 15)
        + SENDER["branch_code"] + pad(SENDER["branch_name"], 15)
        + SENDER["account_type"] + zfill(SENDER["account_number"], 7)
        + " " * 17
    )
    lines.append(header)

    total = 0
    for i, row in enumerate(rows, start=1):
        amount = int(row["amount"])
        total += amount
        data = (
            "2"
            + row["bank_code"] + pad("", 15)          # 被仕向金融機関名は任意(コードが正)
            + row["branch_code"] + pad("", 15)        # 被仕向支店名も同様
            + " " * 4                                  # 手形交換所番号
            + ACCOUNT_TYPE_CODE[row["account_type"]]
            + zfill(row["account_number"], 7)
            + pad(row["kana"], 30)
            + zfill(str(amount), 10)
            + "1"                                      # 新規コード
            + zfill(str(i), 10)                        # 顧客コード1(連番)
            + " " * 10                                 # 顧客コード2
            + "7"                                      # 振込指定区分: telegraphic
            + " "                                      # 識別表示
            + " " * 7
        )
        lines.append(data)

    lines.append("8" + zfill(str(len(rows)), 6) + zfill(str(total), 12) + " " * 101)
    lines.append("9" + " " * 119)

    for n, line in enumerate(lines):
        if jis_len(line) != 120:
            raise ValueError(f"レコード{n}の長さが120桁でない({jis_len(line)})")
    return "\r\n".join(lines) + "\r\n"


def main() -> int:
    data = json.loads((WORK / "extracted_accounts.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)

    confirmed, judgement, insufficient, excluded = [], [], [], []
    all_rows = []
    for rec in data["records"]:
        if rec.get("excluded"):
            # 自動引落など、そもそも振込で払わないもの。二重支払いを防ぐため
            # 要確認ではなく「対象外」として明確に分ける。
            row = {**rec, "status": "対象外", "problems": [], "kana": ""}
            all_rows.append(row)
            excluded.append(row)
            continue
        status, problems, kana = classify(rec)
        row = {**rec, "status": status, "problems": problems, "kana": kana}
        all_rows.append(row)
        {"確定": confirmed, "要判断": judgement}.get(status, insufficient).append(row)

    for group in (confirmed, judgement, insufficient, excluded):
        group.sort(key=lambda r: -r["amount"])
    review = judgement + insufficient

    # コード欠落だけが原因の行を数える(ここが最も回収しやすい)
    code_only = [
        r for r in insufficient
        if all("コード" in p for p in r["problems"])
    ]

    # --- 振込先一覧(全件・人間の確認用) ---------------------------------
    list_path = OUT / "振込先一覧_20260731.csv"
    with list_path.open("w", encoding="cp932", newline="", errors="replace") as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_ALL)
        w.writerow(["判定", "取引先名", "支払額", "金融機関名", "金融機関コード",
                    "支店名", "支店コード", "口座種別", "口座番号",
                    "受取人名(原本表記)", "受取人名カナ(全銀用)", "証憑ID",
                    "要確認事項", "備考(確認済みの論点)"])
        for r in all_rows:
            remarks = list(r.get("notes") or [])
            if r.get("exclusion_reason"):
                remarks.insert(0, r["exclusion_reason"])
            w.writerow([r["status"], r["partner_name"], r["amount"], r["bank_name"],
                        r["bank_code"], r["branch_name"], r["branch_code"],
                        r["account_type"], r["account_number"], r["holder_raw"],
                        r["kana"], r["source"], " / ".join(r["problems"]),
                        " / ".join(remarks)])

    # --- 全銀ファイル(確定分のみ) ----------------------------------------
    zengin_path = OUT / "zengin_soufuri_20260731.txt"
    zengin_path.write_bytes(build_zengin(confirmed).encode("cp932"))

    # --- 要確認リスト -----------------------------------------------------
    def render(rows: list[dict]) -> list[str]:
        out: list[str] = []
        for r in rows:
            out += [f"### {r['partner_name']}　{r['amount']:,}円", ""]
            if r["source"]:
                out.append(f"- 原本: 証憑ID `{r['source']}`")
            if r["bank_name"]:
                out.append(
                    f"- 判明している口座: {r['bank_name']} {r['branch_name']} "
                    f"{r['account_type']} {r['account_number']}".rstrip()
                )
            if r["holder_raw"]:
                out.append(f"- 原本の名義表記: 「{r['holder_raw']}」→ 正規化: `{r['kana']}`")
            for p in r["problems"]:
                out.append(f"- ❌ {p}")
            out.append("")
        return out

    lines = [
        "# 要確認リスト（2026-07-31 支払分）", "",
        f"要確認 {len(review)}件 / 合計 {sum(r['amount'] for r in review):,}円", "",
        "原本は `tools/freee_transfer/input/invoices/<証憑ID>_<取引先名>.pdf` を参照。", "",
        "---", "",
        "## A. 支払うかどうかの判断が必要（口座情報は揃っている）", "",
        f"{len(judgement)}件 / {sum(r['amount'] for r in judgement):,}円", "",
    ]
    lines += render(judgement)
    lines += [
        "---", "",
        "## B. 口座情報が足りない", "",
        f"{len(insufficient)}件 / {sum(r['amount'] for r in insufficient):,}円", "",
        f"うち **金融機関コード／支店コードの欠落だけ** が原因: {len(code_only)}件 "
        f"({sum(r['amount'] for r in code_only):,}円)。"
        "銀行名・支店名・口座番号・名義は原本から取得済みのため、"
        "コードを補えばそのまま振込可能になる。", "",
    ]
    lines += render(insufficient)
    if excluded:
        lines += [
            "---", "", "## C. 今回は振込しない（確認済み）", "",
            f"{len(excluded)}件 / {sum(r['amount'] for r in excluded):,}円", "",
            "自動引落で別途決済されるもの、および支払方法の確認待ちで保留したもの。"
            "**自動引落分は振り込むと二重支払いになる。**", "",
        ]
        for r in excluded:
            lines.append(f"- **{r['partner_name']}** {r['amount']:,}円 — {r['exclusion_reason']}")
        lines.append("")
    (OUT / "review.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # --- サマリ -----------------------------------------------------------
    total_all = sum(r["amount"] for r in all_rows)
    total_ok = sum(r["amount"] for r in confirmed)
    total_excluded = sum(r["amount"] for r in excluded)
    transfer_scope = total_all - total_excluded
    summary = [
        "# サマリ（2026-07-31 支払分）", "",
        "| 区分 | 件数 | 金額 |", "|---|---:|---:|",
        f"| freee 支払管理の対象 | {len(all_rows)} | {total_all:,}円 |",
        f"| うち今回振込しない(自動引落・保留) | {len(excluded)} | -{total_excluded:,}円 |",
        f"| **振込で払う範囲** | **{len(all_rows) - len(excluded)}** | **{transfer_scope:,}円** |",
        f"| 　確定(全銀ファイルに収録) | {len(confirmed)} | {total_ok:,}円 |",
        f"| 　要判断(口座情報は完備) | {len(judgement)} | {sum(r['amount'] for r in judgement):,}円 |",
        f"| 　情報不足 | {len(insufficient)} | {sum(r['amount'] for r in insufficient):,}円 |",
        "",
        f"情報不足のうち **コード欠落だけ** が原因: {len(code_only)}件 / "
        f"{sum(r['amount'] for r in code_only):,}円",
        "", "## 確定分の内訳", "",
        "| 取引先 | 金額 | 金融機関 | 支店 | 口座 | 受取人名 |", "|---|---:|---|---|---|---|",
    ]
    for r in confirmed:
        summary.append(
            f"| {r['partner_name']} | {r['amount']:,} | {r['bank_name']}({r['bank_code']}) "
            f"| {r['branch_name']}({r['branch_code']}) | {r['account_type']} {r['account_number']} "
            f"| {r['kana']} |"
        )
    noted = [r for r in confirmed if r.get("notes")]
    if noted:
        summary += ["", "### 確定分のうち、論点を確認のうえ収録したもの", ""]
        for r in noted:
            for note in r["notes"]:
                summary.append(f"- **{r['partner_name']}**: {note}")
    summary += ["", "## 生成ファイル", "",
                f"- `{list_path.name}` … 振込先一覧(全32件・確認用)",
                f"- `{zengin_path.name}` … PayPay銀行WEB総振アップロード用(確定分のみ)",
                "- `review.md` … 要確認リスト", ""]
    (OUT / "summary.md").write_text("\n".join(summary) + "\n", encoding="utf-8")

    print(f"確定 {len(confirmed)}件 ({total_ok:,}円) / 要確認 {len(review)}件 "
          f"({total_all - total_ok:,}円)")
    print(f"全銀ファイル: {zengin_path} ({zengin_path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
