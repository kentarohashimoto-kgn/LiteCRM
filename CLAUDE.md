# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CATORCE Sales OS（パッケージ名 `catorce-sales-os` / リポジトリ名 `LiteCRM`）。
Next.js 14 App Router + Supabase(RLS) で動くマルチテナントの営業OS / CRM / SFA。
UI・コード内コメント・ドキュメント・コミットメッセージはすべて日本語で書く。

---

## コマンド

```bash
npm ci                 # node_modules は未コミット。最初に必ず実行
npm run dev            # 開発サーバ (http://localhost:3000)
npm run build          # 本番ビルド
npm run typecheck      # tsc --noEmit
npm run test           # vitest run（tests/**/*.test.ts、environment=node）
npm run lint           # next lint（CI では実行されていない）

npx vitest run tests/forecast.test.ts    # 単体ファイル
npx vitest run -t "commit は"            # テスト名で絞り込み
```

**コミット前ゲート**（`docs/exec-plan/GUARDRAILS.md` §5 / `VERIFICATION.md` G-1・G-2）:
`npm run build` が "Compiled successfully"、かつ `npm run typecheck` がエラー0。
ビルドが通らない状態でコミットしない。

環境の注意:

- Supabase の3変数（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`）が無いと `npm run dev` は起動しても認証もデータ取得も通らない。**型チェック・テスト・ビルドは変数なしで通る**ので、変数が無い環境で保証できるのはそこまで。
- `.env.example` の47変数のうち必須は上記3つだけ。他は未設定なら該当機能が 503 / スキップで無効化される設計。
- Node のバージョン指定（`.nvmrc` / `engines`）が無い。CI は Node 20、Claude Code の実行コンテナは Node 22。

---

## アーキテクチャ

### データアクセスの3層

1. **RLS が一次防御。** `src/lib/supabase/server.ts` の `getSupabaseServer()` はログインユーザーのセッションで動くので、取れる行は既に権限でスコープ済み。**画面側でロールによる再フィルタをしない。** RLS をバイパスする `getSupabaseAdmin()`（service role）はメンバー発行と cron バッチだけで使う。
2. **読み取りは `src/lib/data/<domain>.ts` の専用フェッチャ。** `getWorkspace()`（`src/lib/data/workspace.ts`）は全業務データ一括取得で遅く、**新規利用禁止**。page.tsx からの利用は現在0件で、この数は増やさない（`getWorkspaceLite()` は許容、30ページで使用中）。
3. **書き込みは Server Actions。** ドメイン別に `src/server/actions/<domain>.ts`（67ファイル）。`src/server/actions.ts` は約2,500行の旧実装 + 再export ハブで、**新規コードはここに足さずドメインファイルへ**。
   - 更新は `src/server/actions/_helpers.ts` の `casUpdate()` による楽観ロック（読込時の `updated_at` 一致で更新、0行なら競合）。同時編集での上書き消失を防ぐため既存パターンを踏襲する。
   - 更新後は対象ページに `revalidatePath` を必ず入れる。

### 認証とロール

`src/lib/session.ts` のゲート関数でページを囲う。`Ctx = { userId, role, tenantId, email, isPresentation }`。

| ゲート | 用途 | 権限外の飛び先 |
|---|---|---|
| `requireCtx()` | 一般ページ | `/login` |
| `requireAdminCtx()` | owner/admin 専用（マインドマップ等） | `/app/mypage` |
| `requireSalesNumbersCtx()` | 全社の営業数字（ダッシュボード・分析・予測・週報） | `/app/bo` or `/app/mypage` |
| `requireBoCtx()` / `requireHrCtx()` | バックオフィス / 人事 | `/app/mypage` or `/app/bo` |
| `requireProjectCtx()` | 案件原価・粗利管理 | `/app/mypage` |

- ロールは12種（`src/lib/types.ts` の `Role`）。判定は `src/lib/constants.ts` のヘルパー（`canViewSalesNumbers` / `canManageProjects` / `canReassignOwner` など）を使い、配列を直接書かない。
- アプリ側のゲートと DB 側の RLS/RPC 判定は**二重で**掛かっている（RPC 直叩き対策）。片方だけ緩めない。
- プレゼンモード: Cookie `catorce_presentation` はヒントに過ぎず、真は `presentation_sessions` テーブル。有効ならデモテナントの Ctx に切り替わる。

### 3つのサブシステム

- **CRM 本体 `/app/*`** — Supabase Auth のセッション。`src/middleware.ts` がセッション更新と未ログインリダイレクトを行う。
- **AI Lab `/lab/{slug}`** — 契約顧客向けの生成AI体験環境。**CRM の認証系を一切参照しない**独立系統で、middleware の会社別 HTTP Basic → `/lab/{slug}/login` の受講者ログイン（`ailab_session` Cookie）の2段。存在しない会社は 401 ではなく 404 を返す（会社の有無を外から探れないように）。
- **Cron API `/api/cron/*`** — `vercel.json` に13本登録（リージョン `hnd1`、スケジュールは UTC）。認可は `Bearer CRON_SECRET`、`getSupabaseAdmin()` で全テナントを走査、`export const dynamic = "force-dynamic"`。冪等性は実行記録テーブルの一意制約で担保する。

### 会計年度

**7月開始・6月決算**。`src/lib/fiscal.ts` の `FISCAL_START_MONTH = 7`。「今期」「年度」の計算は必ずこのモジュールを通す（暦年で計算しない）。

---

## DB / マイグレーション

- ファイルは `supabase/migrations/00NN_name.sql`。現在210本・最大番号 0202（並行作業の名残で番号の重複が12組ある）。新規は最大番号+1。
- **Supabase MCP の `apply_migration` で本番に適用し、同じ内容をファイルとしてコミットする。** 適用済み SQL とファイルの乖離は禁止。
- 新規テーブルに必須の3点: `tenant_id uuid not null` / RLSポリシー（select は `tenant_id = any(array(select current_tenant_ids()))`、write系はそれに `can_edit_role(tenant_id)` を追加）/ `updated_at` + `set_updated_at` トリガー。
- 新規関数は `set search_path = public, pg_temp` を付ける。SECURITY DEFINER 関数は `revoke execute ... from public, anon;` + `grant execute ... to authenticated;` まで実施する（**関数はデフォルトで PUBLIC に EXECUTE が付くため、anon だけ revoke しても消えない**）。
- **複数テーブル JOIN の集計は RPC 化必須。** security invoker のまま RLS 配下で多段 JOIN するとスキャン毎に RLS が再評価され、`statement_timeout`（authenticated 8s）で落ちる。RPC は `security definer` + テナントを1回だけ解決 + `with ... as materialized` + 明示テナントフィルタ。テンプレートは GUARDRAILS §3-2。
- 性能検証は `set local role authenticated` + `request.jwt.claims` を設定した**本物の認証コンテキスト**で `explain analyze`（root で速くても本番で遅い）。新設 RPC は 500ms 以内が基準。
- DDL 適用後は毎回 `get_advisors(type=security)` を実行して **ERROR=0** を確認し、WARN を増やさない。
- **RLS 無しのテーブルを public スキーマに作らない。** `CREATE TABLE AS` でのバックアップ退避は原則禁止。

---

## 実装上の落とし穴（いずれも過去に事故が起きた箇所）

- **`import` 文はファイル先頭のみ。** Server Actions ファイルの中腹に import を追記するとビルドが壊れる（3回発生）。
- `<form action={...}>` に渡す Server Action は `Promise<void>` を返す。値を返すものはクライアントから関数として呼ぶ。
- CSV やフォーム由来の日付（「2025年4月1日」「25/4/1」）は**正規化してから** DB に入れる（`invalid input syntax for type date` の発生源）。
- NOT NULL 制約: `opportunities.amount`（→ `?? 0`）/ `owner_user_id`（→ 未割当プロファイルへフォールバック）/ `account_id`（→ 無ければ行スキップ）/ `campaign_estimated`（→ false）。
- CSV 取込は既存共通関数を使う: `decodeFileText`（UTF-8 → Shift_JIS フォールバック + BOM除去）/ `uniquifyHeaders` / `parseDelimited`。列の自動マッピングは**完全一致 → 部分一致の2パス**（部分一致のみだと「初回営業日」が「初回商談月」に誤マップする事故が起きた）。
- 既存機能を置き換える場合も旧ルートはすぐ消さず、サイドバーから外すだけにする（ロールバック容易性）。

---

## UI 規約

- 既存プリミティブを踏襲する: `src/components/ui/primitives.tsx`（`PageHeader` / `Section` / `StatCard` / `Card` / `ProgressBar` / `EmptyState` / `LinkButton` / `Avatar`）と `globals.css` の `.card` / `.th` / `.td` / `.row-hover`。
- カトルセ提案書デザインガイド準拠: Primary Teal `#008C8C` / Accent Orange `#F59A2A`、白・グレー70% / ティール20% / オレンジ10%。
- 金額は `formatYen`、数字が縦に並ぶ箇所は `tabular-nums`。
- ページはほぼ `export const dynamic = "force-dynamic"`（158ファイル）。Router Cache は `next.config.mjs` で dynamic 180秒 / static 300秒に延長してあり、書き込み時の `revalidatePath` が無効化の唯一の手段になる。

---

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/exec-plan/GUARDRAILS.md` | **変更前に必ず読む絶対規則。**上記のDB/実装鉄則の原典 |
| `docs/exec-plan/VERIFICATION.md` | 完了時の合否ゲート G-1〜G-9、性能予算、回帰スモークリスト13ページ |
| `docs/exec-plan/WO-*.md` | ワークオーダー単位の仕様と受入基準 |
| `docs/CURRENT_SPEC_2026-07.md` | 現行仕様のスナップショット |
| `docs/ARCHITECTURE_baseline_pre-renewal.md` | リニューアル前アーキテクチャの基準 |
| `docs/DEPLOY.md` / `docs/ONBOARDING.md` / `docs/MANUAL.md` | デプロイ手順 / 新メンバー向け / 操作マニュアル |

機能ごとの設計書が `docs/` 直下に54本ある。ある領域を触る前に、その領域名を含むファイル名（`SEO_` / `EMAIL_` / `AI_LAB_` / `PMO` など）を探すと前提が書かれていることが多い。

---

## 記述が古くなっている箇所（鵜呑みにしない）

- **README の「アーキテクチャ / ディレクトリ」節** — `src/server/actions.ts` 単体・マイグレーション 0001〜0004 という前提のまま。実際は Server Actions は67ファイルに分割され、マイグレーションは210本ある。ディレクトリ構造は実物を見ること。
- **ブランチ運用** — README と `GUARDRAILS.md` §1 は `claude/keen-mayer-yJCVC` 固定・PR禁止と書いているが、実際の運用は作業ごとの `claude/*` ブランチ + PR マージ（直近の main は #150〜#180 の PR 経由）。**セッションで指定されたブランチ名を優先する。**
