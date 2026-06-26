# CATORCE Sales OS — 現行アーキテクチャ設計書（大幅リニューアル前ベースライン）

> 本書は「マーケ施策/プロダクト/顧客レベルを軸にしたROI分析基盤」への大幅リニューアルに着手する**直前の現状(as-is)**を記録するベースラインです。
> 同時点のコードは Git タグ **`pre-renewal-baseline`** およびブランチ **`backup/pre-renewal-baseline`** で復元できます（末尾「復元手順」参照）。
> 作成日: 2026-06-26 / 対象ブランチ: `claude/keen-mayer-yJCVC`

---

## 1. 概要
- **プロダクト**: CATORCE Sales OS（株式会社カトルセ向け CRM/SFA。FY2026-27で5億達成を支援）
- **技術スタック**: Next.js 14.2.x(App Router, RSC, Server Actions) / TypeScript / Tailwind / Supabase(Postgres + Auth + RLS) / Vercel(Hobby, production branch = `claude/keen-mayer-yJCVC`)
- **会計年度**: 7月開始・6月決算（`src/lib/fiscal.ts`）
- **設計原則**: 既存DB/UIへの影響を最小化する**加算的(additive)アプローチ**。既存テーブルは壊さず、列追加 or 付随テーブルで拡張。

## 2. データ取得・認可アーキテクチャ
- **認可**: Supabase RLS。`current_tenant_ids()`(SECURITY DEFINER, memberships参照) を各テーブルポリシーで使用。書込は `can_edit_role()`、閲覧範囲は `can_view_all()`。
- **セッション**: `src/lib/session.ts` の `getCtxOrNull` は `getSession()`（Cookieのみ・ネットワーク無し、middlewareで検証）。
- **ワークスペース取得**: 単一RPCで一括取得。
  - `getWorkspace()` → RPC `workspace_full`（全参照データ）
  - `getWorkspaceLite()` → RPC `workspace_lite`（案件/KPI向けの軽量版）
- **集計はSQL/RPC側**（メモリ集計を排除、1万件規模対応）:
  - `lead_metrics()`（リードの月別/流入別/ファネル集計）
  - `sales_actuals(start,end)`（売上実績）
  - `recompute_engagement(p_tenant)`（接点→エンゲージメント再計算, SECURITY DEFINER）
  - `seminar_followup(p_seminar)` / `seminar_list()`（セミナー攻略リスト, SECURITY DEFINER）
  - `norm_company(text)` / `engagement_rank_of(int)`（正規化・ランク判定）
- **パフォーマンス**: `next.config.mjs` の `experimental.staleTimes`(dynamic:180/static:300)、`src/app/app/loading.tsx` のスケルトン、`/api/warm` ウォーム用エンドポイント。

## 3. 画面モジュール（`src/app/app/**`）
| グループ | ルート | 役割 |
|---|---|---|
| 営業 | `/dashboard` | 着地サマリー・月別推移・ファネル・年度切替(?fy=) |
| 営業 | `/reviews/weekly` | 週次レビュー |
| 営業 | `/opportunities`(+`/[id]`,`/new`,`/[id]/meetings/[mid]`) | 案件・商談・会議 |
| 営業 | `/forecast` | 売上予測(Commit/BestCase/Weighted) |
| 営業 | `/targets` | 目標入力 |
| 経営レビュー | `/exec`,`/exec/kpi`,`/exec/deals`,`/exec/marketing`,`/exec/delivery`,`/exec/projects`,`/exec/actions`,`/exec/calc`,`/exec/history` | 週次幹部振り返り(KPI/商談読み/マーケ/デリバリー/開発顧問/アクション/売上逆算/履歴) |
| 顧客・活動 | `/accounts`(+`/[id]`,`/new`),`/contacts`,`/leads`(+`/[id]`,`/import`),`/tasks`,`/activities` | 顧客/担当者/リード/タスク/活動 |
| 顧客・活動 | `/srank`(+`/[id]`),`/nurture` | Sランク攻略 / 既存顧客深耕 |
| 分析 | `/analytics/revenue`,`/trends`,`/channels`,`/exhibitions`,`/exhibition-select`,`/seminars`,`/seminar-followup`,`/sales-reps`,`/products` | 売上請求/トレンド/流入元/展示会(分析・選定)/セミナー(分析・攻略)/営業マン別/商品別 |
| 設定 | `/settings` | 設定 |
| セミナー | `/seminars/import` | セミナー参加者取込 |

## 4. ロジック層（`src/lib/**`）
- ドメインロジック: `fiscal.ts`(年度), `forecast.ts`(予測), `targets.ts`(目標vs実績), `revenue.ts`, `subscription.ts`, `risk.ts`, `analytics.ts`(rep/product metrics), `lead-funnel.ts`(ファネル段階), `exec-review.ts`(Good/Watch/Bad判定), `exhibition.ts`(展示会スコア), `srank.ts`, `nurture.ts`, `trends.ts`, `seminar-followup.ts`(攻略スコア)
- 取込/出力: `lead-import.ts`(列マッピング・Shift_JIS復号・ヘッダ一意化), `seminar-import.ts`, `lead-export.ts`(CSVプリセット出力)
- データアクセス: `src/lib/data/*.ts`（workspace, leads, leads-workspace, select, exec, exhibition, srank, nurture, trends, seminar-followup）
- 基盤: `types.ts`, `utils.ts`, `constants.ts`, `session.ts`, `supabase/{server,admin}.ts`

## 5. サーバーアクション
- `src/server/actions.ts`（約1,500行）にフォーム/ミューテーションを集約。フォームアクションは `Promise<void>` を返す規約。
- 主な系統: 取込(lead/seminar batch), 予測入力, サブスク追加, エンゲージ再計算, CSV出力プリセット, 経営レビュー各種保存, Sランク, 深耕, リード昇格(案件化)/ファネル段階, 展示会候補。
- 編集権限ロール: `REVIEW_EDIT=["owner","admin","sales_manager","sales_rep","external_sales"]`。展示会の最終決定は owner/admin/sales_manager のみ。

## 6. UIコンポーネント（`src/components/**`）
レイアウト(sidebar 折りたたみ対応/topbar)、charts(forecast/trend/exhibition/rep/stacked/appointment)、dashboard(funnel-view/fy-tabs)、leads(workspace/import/download/promote)、opportunities(table/views/calendar/mini)、billing(subscription)、analytics(trends/rep/share)、exec(period/calc)、ui(primitives/badges)。

## 7. データベース（`public` スキーマ・主要テーブル）
- **テナント/認証**: tenants, tenant_settings, memberships, profiles, invitations, audit_logs
- **顧客系**: accounts(19), contacts(16), acquirer_aliases, person_engagement(8), touchpoints(12)
- **リード系**: leads(50), lead_sources(7), lead_import_batches, lead_export_presets, seminar_responses(21)
- **案件系**: opportunities(35), opportunity_products(8), opportunity_change_logs, stage_histories, meetings(15), activities, tasks
- **商品/施策**: products(14), product_categories(4), campaigns(22)
- **金額/予測**: billing_schedules(13), sales_targets, rep_targets, forecast_snapshots
- **経営レビュー**: weekly_kpi_targets, weekly_kpi_results, weekly_reviews, mtg_actions, opportunity_review_extensions, campaign_review_extensions, delivery_reviews, project_profit_reviews
- **攻略/深耕**: srank_accounts(25), srank_departments(19), srank_keypersons(17), account_nurture(16), nurture_touches(10)
- **展示会選定**: exhibition_candidates(23)

### リニューアルで再利用できる既存資産（重要）
- `campaigns`: `channel, organizer, cost, expected_leads, actual_leads, appointments, reported_deals, reported_revenue, sort_order` → **施策のコスト/ファネル/成果が一部既に保持**（ただし階層・月次コスト・コミット量は未対応）
- `products`: `category_id, category, default_price, default_gross_profit_rate, is_recurring, release_date` → **カテゴリ・継続課金フラグ・粗利率を保持**（原価/デリバリー工数/重点フラグ/派生関係は未対応）
- `opportunity_products`: 1案件複数商品の明細（amount/gross_profit/quantity）
- `billing_schedules`: `recurring_start_month/recurring_end_month` → **サブスクMRRが算出可能**（解約日/理由は未対応）
- `opportunities`: `lead_source_id, campaign_id, primary_product_id, amount, gross_profit, renewal_*` → **施策→受注・商品→受注のアトリビューションが既に可能**

## 8. マイグレーション一覧
`supabase/migrations/0001`〜`0025`（init→RLS→profiles→campaigns→yomi→meetings→billing→rep_probability→subscription_renewal→touchpoints/engagement→export_presets→split_name→exec_review(1/234)→lead_metrics→workspace_lite→sales_actuals→srank→nurture→funnel_stage→exhibition_candidates→seminar_followup）。

## 9. デプロイ
- Vercel(Hobby)。production branch = `claude/keen-mayer-yJCVC`。`vercel.json` は削除済（Hobbyのcron制約で失敗したため）。詳細は `docs/DEPLOY.md`。
- 機密(service_role等)はVercel環境変数のみ。リポジトリに置かない。

## 10. 復元手順（このベースラインへ戻す）
```bash
# タグから現状を確認/チェックアウト
git fetch origin --tags
git checkout pre-renewal-baseline        # detached HEAD で内容確認

# 作業ブランチをベースラインへ戻す場合（破壊的・要注意）
git checkout claude/keen-mayer-yJCVC
git reset --hard pre-renewal-baseline

# 特定モジュールだけ復元する場合
git checkout pre-renewal-baseline -- src/app/app/dashboard/page.tsx
git checkout pre-renewal-baseline -- src/lib/lead-import.ts
```
- DB側は `supabase/migrations/0001`〜`0025` がこのベースラインのスキーマ。リニューアルの追加は `0026` 以降で行い、各マイグレーションに対応するロールバック手順を併記する。
- バックアップ参照: タグ `pre-renewal-baseline` / ブランチ `backup/pre-renewal-baseline`（origin にpush済み）。
