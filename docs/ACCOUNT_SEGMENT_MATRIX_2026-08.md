# 顧客分析マトリクス（セグメント × ランク）設計メモ

作成: 2026-08 ／ 対象: `/app/accounts/matrix`

## 1. 目的

「どの業界（セグメント）の、どのランクの顧客を、何社持っているか」を1画面で把握し、
顧客名から顧客・案件の詳細まで遷移せずに降りられるようにする。

- 行 = セグメント（住宅・建築 / IT・ソフトウェア / 製造 / 金融・保険 …）
- 列 = ランク（S / A / B / C / D）
- セル = 顧客名のリスト（社数・累計受注つき）
- 顧客名クリック → 画面右 2/3 の特大ペインで顧客サマリ・案件・担当者・活動履歴を表示
- 絞り込み（営業担当・会社規模・取引額・取引時期ほか）と会社名検索 → 6章

## 2. 画面

| 要素 | 挙動 |
|---|---|
| セグメント行 | 既定は上位5件のみ表示。「もっと見る」で全件展開（`DEFAULT_VISIBLE_SEGMENTS`） |
| 未分類行 | 常に最後。件数が多くても分類済みの見通しを潰さないため |
| セル内の顧客名 | 累計受注の降順で最大8件（`MAX_ACCOUNTS_PER_CELL`）。超過分は「他N社」で追加読込 |
| 右ペイン | `lg:w-2/3`（狭い画面は全幅）。Esc・背景クリックで閉じる。↑↓ でセル内を連続確認 |
| セグメント設定 | 並び順（上下ボタン）・表示/非表示・名称/色/キーワード・ランク閾値 |
| 絞り込みバー | 表の上。条件を変えると 250ms のデバウンス後に RPC から引き直す |
| 検索ヒットの案内 | 会社名検索時のみ。「会社名 ｜ セグメント × ランク」のチップ。クリックでそのセルへスクロール＋強調し、右ペインを開く |

セルの背景は社数に応じたティールの濃淡。顧客名の横の ✦ は「ランクが自動判定（手動未設定）」の印。

## 3. データモデル

マイグレーション: `supabase/migrations/0204_account_segment_matrix.sql`（本体）、
`0205_account_matrix_filters.sql`（絞り込み・検索。RPC 3本を差し替え）

### `account_segments`（セグメントマスタ）

| 列 | 用途 |
|---|---|
| `name` / `color` | 表示 |
| `keywords text[]` | `accounts.industry` への部分一致で自動マッピング |
| `sort_order` | 行の並び順。マッチが複数ある場合も、これが小さい方を採用 |
| `is_visible` | マトリクスの行に出すか（非表示にしてもデータは消えない） |

### `accounts.segment_id`

手動割当。**自動マッピングより常に優先**。`on delete set null` なので、
セグメントを削除しても顧客は消えず未分類に戻る。

### `account_rank_settings`（ランク自動判定の閾値・テナントごと1行）

`s_revenue` / `a_revenue` / `a_potential` / `b_potential` / `s_employees` / `a_employees`。

## 4. セグメントとランクの決定ロジック

**セグメント**: `accounts.segment_id`（手動） → `industry` のキーワード部分一致（`sort_order` 順の先頭） → 未分類

**ランク**: `accounts.rank`（手動）が最優先。未設定なら下記で自動判定する。

| ランク | 既定の条件 |
|---|---|
| S | 大企業（1,000名〜） または 累計受注 1億円以上 |
| A | 中堅企業（100名〜） または 累計受注 1,000万円以上 または 進行中見込み 1億円以上 |
| B | 累計受注あり または 進行中見込み 1,000万円以上 |
| C | 案件はあるが受注・上記見込みなし |
| D | 案件なし |

旧データの `rank = 'dormant'` は D 相当に寄せる。

**自動判定を入れた理由**: 本番の `accounts` は `rank` 未設定が 738/784 件、`industry` 未設定が 692/784 件。
手動ランクだけを見るとマトリクスがほぼ空になり、機能として成立しない。
閾値は画面から変更できるので、運用に合わせて調整する。

### 従業員数の解釈

`accounts.employee_size` は自由入力で表記が揺れる（`1,000名以上` / `101〜300名` / `838名（単体）` / `100～1000名未満`）。
`public.account_employee_count(text)` は **含まれる数値の最小値** を採用する。
範囲表記で上振れさせないため（`301〜1000名` を大企業と誤判定しない）。
既存の `size_band()` はカンマ入り（`1,000名以上`）を取りこぼすので流用していない。

## 5. RPC

複数テーブルJOINの集計なので RPC 化必須（GUARDRAILS §3-2）。3本とも
`security definer` + 明示テナントフィルタ + `with ... as materialized`。

| 関数 | 用途 |
|---|---|
| `account_matrix_base(p_filter jsonb)` | セグメント・ランク解決＋**絞り込み**の共通土台。下2本がこれを使う（ロジックの二重持ちを避ける） |
| `account_segment_matrix(p_max_per_cell int, p_filter jsonb)` | マトリクス本体。`{ settings, segments[], cells[], matches[] }` |
| `account_segment_rank_accounts(p_segment, p_rank, p_offset, p_limit, p_filter)` | 「他N社」の追加読込。`p_segment = '__none__'` で未分類 |

実測（本物の認証コンテキスト・本番データ 784社）: 絞り込みなし 約56ms、
会社名＋担当＋規模＋取引額＋時期＋案件状況を全部掛けた状態で約29ms。基準の500ms以内。

`p_filter` はセル集計とセル明細で**同じものを渡す**。渡し忘れると「他N社」の件数と中身がずれる。

0204 では削除済み案件（`opportunities.deleted_at`）を集計から除外しておらず、
顧客一覧（`accounts_page`）の累積売上と金額が食い違っていた。0205 で併せて除外した。

## 6. アプリ側

| ファイル | 役割 |
|---|---|
| `src/lib/account-matrix.ts` | 型・定数・凡例テキスト生成（`rankCriteria`）・絞り込み条件の組み立て（`buildMatrixFilter`） |
| `src/lib/data/account-matrix.ts` | RPC 呼び出し |
| `src/server/actions/account-segments.ts` | セグメントCRUD・並び替え・表示切替・閾値保存 |
| `src/server/actions/account-panel.ts` | 右ペインのデータ取得、セグメント/ランクの更新（`casUpdate` の楽観ロック）、セル明細 |
| `src/components/accounts/segment-rank-matrix.tsx` | マトリクス本体（絞り込み状態と検索ヒットの案内もここ） |
| `src/components/accounts/matrix-filter-bar.tsx` | 絞り込みバー |
| `src/components/ui/multi-select.tsx` | 複数選択のプルダウン（顧客一覧の同等品を切り出した共通版） |
| `src/components/accounts/account-side-panel.tsx` | 右ペイン（特大） |
| `src/components/accounts/segment-editor.tsx` | セグメント設定パネル |
| `src/app/app/accounts/matrix/page.tsx` | ページ（`requireCtx`／`force-dynamic`） |

権限は顧客一覧（`/app/accounts`）と同じ `requireCtx`。取得行は RLS でスコープ済みなので画面側で再フィルタしない。
セグメントの書き込みは RLS の `can_edit_role(tenant_id)`（owner/admin/sales_manager/sales_rep/external_sales）が一次防御。

## 6.5. 絞り込みと検索

### 条件（`MatrixFilterState` → `buildMatrixFilter()` → RPC の `p_filter`）

| 画面 | `p_filter` | 判定 |
|---|---|---|
| 会社名 | `q` | `name` の部分一致 **または** `search_key` の部分一致（0203 の `company_search_key`）。「カインズ株式会社」「ｶｲﾝｽﾞ」でも「株式会社カインズ」に当たる |
| 営業担当 | `owner[]` | `accounts.owner_user_id`。`__none` で未割当 |
| エリア | `area[]` | `accounts.area` |
| 区分 | `status[]` | 見込み / 顧客 / 休眠 |
| 会社規模 | `empMin` / `empMax` / `empUnknown` | `account_employee_count(employee_size)`。1,000名以上 / 300〜999 / 100〜299 / 30〜99 / 29名以下 / 記載なし |
| 取引額 | `wonMin` / `wonMax` / `wonNone` | 受注済み案件の合計。1億 / 3,000万 / 1,000万 / 100万 / 実績あり / 実績なし |
| 取引時期 | `wonFrom` / `wonTo` / `lastWonBefore` | 受注案件の `expected_close_date`。直近3ヶ月・6ヶ月・1年 / 今期・前期（**7月開始6月決算**） / 1年・2年以上受注なし |
| 案件状況 | `openState` | 進行中案件あり / なし |

- 相対期間（「直近3ヶ月」「今期」）は**アプリ側で日付に落としてから**渡す。
  DB で `now()` を使うと年度の定義が二重管理になり、テストでも固定できないため。
- 数値・日付・真偽値は RPC 側で文字列から安全に取り出す（不正値は無視）。
  jsonb を直接 `::int` / `::date` すると壊れた値で 500 になる。
  真偽値は `coalesce((f->>'x') = 'true', false)` とすること。**`coalesce` を外すとキー未指定時に NULL となり、
  `not won_none` が NULL 判定になって条件に合う行が丸ごと落ちる**（実装中に踏んだ）。

### 検索ヒットの案内（`matches`）

絞り込むだけだと「元のマトリクスのどこに居たのか」が分からなくなるため、
`q` があるときだけ `matches[]`（`id` / `name` / `segmentKey` / `rank` / `won`、上位30件）を返し、
画面上部に「会社名 ｜ セグメント × ランク」のチップを出す。
チップをクリックすると該当セルへスクロールして強調し、右ペインを開く（←→ でヒット間を移動）。
セル内でヒットした顧客名はオレンジで強調する。

### 表示のふるまい

- 絞り込み中はセグメント行を畳まない（ヒットした行が「もっと見る」の裏に隠れると探せないため）。
- **非表示セグメント**でも、絞り込み結果に顧客が残っていれば行を出す（`非表示` バッジ付き）。
- 「該当N社 ／ 全M社」の分母は、ページ初期表示（絞り込みなし）の結果を基準にする。

## 7. 運用メモ

- 未分類が多い場合は、右ペインでセグメントを選ぶ（その顧客だけ固定される）か、
  セグメント設定でキーワードを足す（該当する顧客がまとめて動く）。後者のほうが効率が良い。
- セグメントを非表示にすると、所属していた顧客はマトリクスから消える。
  消えたように見えないよう、表の下に「非表示セグメントに N社」を出している。
- ランクを手動で付けると自動判定より優先される。右ペインの「自動」ボタンで戻せる。

## 8. 今後

- 絞り込み条件のURL反映（現状はリロードでリセットされる）／条件の保存
- セルからCSV書き出し（現状は顧客一覧側の機能を使う）
- セグメント別の受注率・平均単価の併記（現状は社数と累計受注のみ）
