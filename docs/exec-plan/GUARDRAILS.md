# 実行ガードレール（全ワークオーダー共通・最初に必ず読むこと）

> 本書は実行AI（Sonnet）向けの**絶対規則**。ここに反する変更はしてはならない。
> 判断に迷ったら「加算的・非破壊・既存パターン踏襲」を選び、逸脱が必要ならユーザーに確認する。

---

## 1. 環境・識別子

- リポジトリ: `kentarohashimoto-kgn/LiteCRM`（作業ディレクトリ `/home/user/LiteCRM`）
- **ブランチ: `claude/keen-mayer-yJCVC` のみ。他ブランチ（特にmain）へのpush禁止。PRは作らない**（ユーザーが明示要求した場合のみ）
- Supabaseプロジェクト: `catorce-sales-os` / project_id `beztpddkezjlrlixjjqq`（Supabase MCPツールで操作）
- テナント: `00000000-0000-0000-0000-000000000001` / オーナーuser: `dd21a355-05c4-4132-899b-f321873b42d3`
- 会計年度: 7月開始6月決算（`src/lib/fiscal.ts`、FISCAL_START_MONTH=7）
- スタック: Next.js 14.2 App Router / RSC / Server Actions / TypeScript / Tailwind / Supabase(RLS)

## 2. セキュリティ鉄則（違反厳禁）

1. **service_role キー・DB接続文字列・APIキーをコード/リポジトリに書かない**。環境変数はVercelのみ。ローカルには `NEXT_PUBLIC_SUPABASE_URL` と `ANON_KEY` しか無い前提で実装する。
2. **publicスキーマに RLS無しテーブルを作らない**。`CREATE TABLE AS` でのバックアップ退避は原則禁止（過去にlinter ERRORと情報公開リスクを起こした）。データ退避が必要なら (a)そもそも退避せず migrationのdown手順を書く、(b)やむを得ない場合は作成直後に `enable row level security` + `revoke all from anon, authenticated` を同一migration内で実施し、**作業完了後すみやかにDROP**する。
3. 新規テーブルは必ず: `tenant_id uuid not null` / RLSポリシー（select: `tenant_id = any(array(select current_tenant_ids()))`、write系: 同条件 + `can_edit_role(tenant_id)`）/ `updated_at` + `set_updated_at`トリガー。
4. 新規関数は必ず `set search_path = public, pg_temp` を付ける。SECURITY DEFINER関数は `revoke execute ... from public, anon; grant execute ... to authenticated;` を同時に実施（**関数はデフォルトでPUBLICにEXECUTEが付く**ことに注意。anonだけrevokeしても消えない）。
5. DDL適用後は毎回 `get_advisors(type=security)` を実行し、**ERROR=0** を確認。新たなWARNを増やさない。
6. コミットに実行モデルのID等を書かない。ハーネスが付ける標準トレーラーのみ使用。

## 3. DBパフォーマンス鉄則（実測に基づく）

1. **複数テーブルJOINの集計はRPC化必須**。`security invoker`のままRLS配下で多段JOINすると**RLSがスキャン毎に再評価されタイムアウト**する（authenticated: statement_timeout=8s / anon: 3s。過去に本番で500エラーを起こした）。
2. RPCの必須テンプレート:
```sql
create or replace function public.my_metric(p_start date, p_end date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());  -- テナントを1回だけ解決
  result jsonb;
begin
  with base as materialized (                       -- materialized 必須
    select ... from opportunities o
    where o.tenant_id = any(v)                      -- 明示テナントフィルタ
  )
  select jsonb_build_object(...) into result from base;
  return result;
end $$;
revoke execute on function public.my_metric(date, date) from public, anon;
grant execute on function public.my_metric(date, date) to authenticated;
```
3. RPCの性能検証は**本物の認証コンテキスト**で行う（rootで速くても本番で遅い）:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dd21a355-05c4-4132-899b-f321873b42d3","role":"authenticated"}', true);
set local statement_timeout = '8s';
explain analyze select public.my_metric('2025-07-01','2026-06-30');
rollback;
```
4. `mcp__Supabase__execute_sql` は**大きい出力を切り詰める**。大量データの移送には使わない（取込はアプリのCSV画面経由）。

## 4. アプリ実装鉄則

1. **`getWorkspace()` の新規利用禁止**（全業務データ一括取得のため遅い）。ページに必要なデータだけを `src/lib/data/` の専用フェッチャで取得する。`getWorkspaceLite()` は許容だが新規は専用フェッチャ優先。
2. `import` 文は**ファイル先頭のみ**（Server Actionsファイル中腹へのimport追記でビルド破壊が3回起きた）。
3. Server Actions: `<form action={...}>` に渡すものは `Promise<void>` を返す。値を返すものはクライアントから関数呼び出しで使う。actions は今後 `src/server/actions/<domain>.ts` に分割し、`src/server/actions.ts` は再exportのハブにする（WO-00で実施。以後1ファイル肥大禁止）。
4. 日付の正規化: CSVやフォーム由来の「2025年4月1日」「25/4/1」等は必ず正規化してからDBへ（`actions.ts`内の`d()`ヘルパー参照。invalid dateでのinsert失敗が過去に発生）。
5. NOT NULL制約に注意: `opportunities.amount`(→`?? 0`), `owner_user_id`(→未割当プロファイルへフォールバック), `account_id`(→無ければ行スキップ), `campaign_estimated`(→false)。
6. CSV取込は既存共通関数を使う: `decodeFileText`(UTF-8→Shift_JIS fallback+BOM除去) / `uniquifyHeaders`(空・重複ヘッダ) / `parseDelimited`。列自動マッピングは**完全一致→部分一致の2パス**（`suggestDealMapping`参照。部分一致のみだと誤マップ事故）。
7. UI: 既存プリミティブ（`PageHeader`/`Section`/`StatCard`/`.card`/`.th`/`.td`/`row-hover`等）とteal系トークンを踏襲。日本語UI。金額は`formatYen`、`tabular-nums`。
8. `revalidatePath` を更新systemの対象ページに必ず入れる。

## 5. 品質ゲート（コミット前に毎回）

```bash
npm run build          # "Compiled successfully" 必須
npx tsc --noEmit       # 型エラー0
```
- ビルドが通らない状態でのコミット禁止。
- コミットメッセージは日本語可。`git push -u origin claude/keen-mayer-yJCVC`（ネットワークエラー時のみ2s/4s/8s/16sで再試行）。

## 6. 変更管理

- マイグレーションファイルは `supabase/migrations/00NN_name.sql`（0042から連番）。**`mcp__Supabase__apply_migration` で本番適用**し、同内容をファイルとしてコミット（適用とファイルの乖離禁止）。
- 破壊的操作（テーブル削除・全件削除・列削除・RLS変更）は、**ワークオーダーに明記されている場合のみ**。それ以外は提案に留めユーザー承認を待つ。
- 既存機能を置き換える場合も**旧ルートは1WOの間は残し**、サイドバーから外すだけにする（ロールバック容易性）。
- 各WO完了時の報告に含めるもの: ①変更ファイル一覧 ②適用migration ③VERIFICATION該当項目の実行結果 ④スコープ外にした事項と理由。

## 7. してはいけないことの再確認（過去事故の再発防止）

| 禁止 | 過去に起きたこと |
|---|---|
| RLS無しバックアップテーブル放置 | Supabaseから「一般公開」ERROR警告 |
| security invokerのまま重い集計RPC | 本番8s超タイムアウト→画面が空 |
| 部分一致だけの列マッピング | 「初回営業日」が「初回商談月」に誤マップ→アポ数が全滅 |
| ファイル中腹へのimport追記 | ビルド失敗3回 |
| anonのみrevoke（PUBLIC残置） | 権限剥奪が効かず再修正 |
| 日本語日付を未変換でinsert | `invalid input syntax for type date` |
