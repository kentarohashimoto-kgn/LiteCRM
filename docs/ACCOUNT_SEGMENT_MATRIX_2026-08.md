# 顧客分析マトリクス（セグメント × ランク）設計メモ

作成: 2026-08 ／ 対象: `/app/accounts/matrix`

## 1. 目的

「どの業界（セグメント）の、どのランクの顧客を、何社持っているか」を1画面で把握し、
顧客名から顧客・案件の詳細まで遷移せずに降りられるようにする。

- 行 = セグメント（住宅・建築 / IT・ソフトウェア / 製造 / 金融・保険 …）
- 列 = ランク（S / A / B / C / D）
- セル = 顧客名のリスト（社数・累計受注つき）
- 顧客名クリック → 画面右 2/3 の特大ペインで顧客サマリ・案件・担当者・活動履歴を表示

## 2. 画面

| 要素 | 挙動 |
|---|---|
| セグメント行 | 既定は上位5件のみ表示。「もっと見る」で全件展開（`DEFAULT_VISIBLE_SEGMENTS`） |
| 未分類行 | 常に最後。件数が多くても分類済みの見通しを潰さないため |
| セル内の顧客名 | 累計受注の降順で最大8件（`MAX_ACCOUNTS_PER_CELL`）。超過分は「他N社」で追加読込 |
| 右ペイン | `lg:w-2/3`（狭い画面は全幅）。Esc・背景クリックで閉じる。↑↓ でセル内を連続確認 |
| セグメント設定 | 並び順（上下ボタン）・表示/非表示・名称/色/キーワード・ランク閾値 |

セルの背景は社数に応じたティールの濃淡。顧客名の横の ✦ は「ランクが自動判定（手動未設定）」の印。

## 3. データモデル

マイグレーション: `supabase/migrations/0204_account_segment_matrix.sql`

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
| `account_matrix_base()` | セグメント・ランク解決の共通土台。下2本がこれを使う（ロジックの二重持ちを避ける） |
| `account_segment_matrix(p_max_per_cell int)` | マトリクス本体。`{ settings, segments[], cells[] }` |
| `account_segment_rank_accounts(p_segment, p_rank, p_offset, p_limit)` | 「他N社」の追加読込。`p_segment = '__none__'` で未分類 |

実測（本物の認証コンテキスト・本番データ 784社）: `account_segment_matrix` 約 32〜130ms。基準の500ms以内。

## 6. アプリ側

| ファイル | 役割 |
|---|---|
| `src/lib/account-matrix.ts` | 型・定数・凡例テキスト生成（`rankCriteria`） |
| `src/lib/data/account-matrix.ts` | RPC 呼び出し |
| `src/server/actions/account-segments.ts` | セグメントCRUD・並び替え・表示切替・閾値保存 |
| `src/server/actions/account-panel.ts` | 右ペインのデータ取得、セグメント/ランクの更新（`casUpdate` の楽観ロック）、セル明細 |
| `src/components/accounts/segment-rank-matrix.tsx` | マトリクス本体 |
| `src/components/accounts/account-side-panel.tsx` | 右ペイン（特大） |
| `src/components/accounts/segment-editor.tsx` | セグメント設定パネル |
| `src/app/app/accounts/matrix/page.tsx` | ページ（`requireCtx`／`force-dynamic`） |

権限は顧客一覧（`/app/accounts`）と同じ `requireCtx`。取得行は RLS でスコープ済みなので画面側で再フィルタしない。
セグメントの書き込みは RLS の `can_edit_role(tenant_id)`（owner/admin/sales_manager/sales_rep/external_sales）が一次防御。

## 7. 運用メモ

- 未分類が多い場合は、右ペインでセグメントを選ぶ（その顧客だけ固定される）か、
  セグメント設定でキーワードを足す（該当する顧客がまとめて動く）。後者のほうが効率が良い。
- セグメントを非表示にすると、所属していた顧客はマトリクスから消える。
  消えたように見えないよう、表の下に「非表示セグメントに N社」を出している。
- ランクを手動で付けると自動判定より優先される。右ペインの「自動」ボタンで戻せる。

## 8. 今後

- セルからCSV書き出し（現状は顧客一覧側の機能を使う）
- セグメント別の受注率・平均単価の併記（現状は社数と累計受注のみ）
