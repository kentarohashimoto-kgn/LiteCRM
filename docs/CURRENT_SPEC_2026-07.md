# CATORCE Sales OS — 現状の画面・仕様設計書（as-is / 2026-07 時点）

> 目的: 大幅な使い勝手見直しに着手する前に、**現状の全画面・仕様・データ構造・パフォーマンス特性**を棚卸しして記録する。
> 対になる改善提案は `docs/IMPROVEMENT_PROPOSAL_2026-07.md`。
> 作成日: 2026-07-04 / 対象ブランチ: `claude/keen-mayer-yJCVC` / 前回ベースライン: `docs/ARCHITECTURE_baseline_pre-renewal.md`(2026-06-26)

---

## 1. サマリー（要点）

- **画面数**: `page.tsx` = 48（実ルート 44）。サイドバー導線 = **5グループ・37項目**。
- **DBマイグレーション**: 41本（0001〜0041）。主要テーブル約50。
- **技術**: Next.js 14.2（App Router / RSC / Server Actions）/ TypeScript / Tailwind / Supabase(Postgres + Auth + RLS) / Vercel。
- **会計年度**: 7月開始・6月決算。
- **現状の3大課題（客観事実）**:
  1. **導線の肥大**: 37メニュー項目。特に「分析」だけで13項目、類似画面が併存。
  2. **レスポンス**: 主要16ページが `getWorkspace()` で**全業務データを毎回1RPC取得**。20ページが `force-dynamic`（毎回サーバー再取得）。データ増加（案件681/商談626/リード11.6MB）で体感が悪化。
  3. **Notion代替性**: 案件の主投入経路が**CSV全置換取込**。Notion/スプレッドシートが実質の入力元で、CATORCE側はほぼ「閲覧・分析」。日常のインライン編集・ボード運用が弱い。

---

## 2. ナビゲーション / 情報設計（IA）

現状のサイドバー（`src/components/layout/sidebar.tsx`）。**37項目**。

| グループ | 項目数 | 項目 |
|---|---|---|
| **営業** | 7 | ダッシュボード / 週次レビュー / 案件 / 商談取込(Notion) / 売上予測 / 受注見込み(来期) / 目標入力 |
| **経営レビュー** | 9 | 週次サマリー / 営業KPI振り返り / 商談・読み管理 / マーケ施策管理 / デリバリー品質 / 開発・顧問案件 / アクション管理 / 売上逆算 / 振り返り履歴 |
| **顧客・活動** | 7 | 顧客 / Sランク攻略 / 既存顧客深耕 / 担当者 / リード / タスク / 活動履歴 |
| **分析** | 13 | 売上・請求分析 / 施策ROI分析 / 施策×顧客レベル / トレンド分析 / 流入元分析 / └展示会分析 / └展示会(時系列/主催/テーマ) / └展示会選定 / └セミナー分析 / └セミナー攻略リスト / 営業マン別 / 商品別 / プロダクト収益分析 |
| **設定** | 1 | 設定 |

**IA上の重複・近接**（要統合候補）:
- 展示会系が **3画面**（`exhibitions` / `exhibition-roi` / `exhibition-select`）。
- セミナー系が **2画面 + 取込**（`seminars` / `seminar-followup` / `seminars/import`）。
- ROI/収益系が **4画面**（`roi` / `product-roi` / `revenue` / `matrix`）。
- 予測系が **2画面**（`forecast` / `forecast/pipeline`）。
- 「経営レビュー(exec)」9画面は週次幹部レビュー専用で、日常の営業導線と混在。

---

## 3. 画面カタログ（ルート別）

### 3.1 営業
| ルート | 役割 | データソース | 主な操作 |
|---|---|---|---|
| `/dashboard` | 着地サマリー・月別推移・ファネル・年度切替(?fy=) | `getWorkspaceLite` + `lead_metrics` | 閲覧・年度切替 |
| `/reviews/weekly` | 週次レビュー入力・表示 | `getWorkspace` | 入力(saveWeeklyReview) |
| `/opportunities`(+`/[id]`,`/new`,`/[id]/meetings/[mid]`) | 案件一覧/詳細/新規/商談ログ | `getWorkspace` | 一覧(表/ビュー/カレンダー)、作成・更新 |
| `/opportunities/import` | **Notion商談ヨミ表CSVの全置換取込** | Server Action | CSVアップロード→列マッピング→全置換 |
| `/forecast` | 売上予測(Commit/BestCase/Weighted) + 受注見込み計画反映 | `getWorkspace` + `listRevenueForecasts` | 閲覧・年度切替 |
| `/forecast/pipeline` | 来期(FY2026-07+)受注見込みシート管理 | `revenue_forecasts` | CSV取込・行編集 |
| `/targets` | 月次目標入力 | `getWorkspace` | 入力(saveTargets/saveRepTargets) |

### 3.2 経営レビュー（exec：週次幹部レビュー）
| ルート | 役割 |
|---|---|
| `/exec` | 週次サマリー（Good/Watch/Bad） |
| `/exec/kpi` | 営業KPI振り返り（目標vs実績） |
| `/exec/deals` | 商談・ヨミ管理 |
| `/exec/marketing` | マーケ施策管理 |
| `/exec/delivery` | デリバリー品質レビュー |
| `/exec/projects` | 開発・顧問(サブスク)案件 |
| `/exec/actions` | アクション管理 |
| `/exec/calc` | 売上逆算シミュレーション |
| `/exec/history` | 振り返り履歴 |

### 3.3 顧客・活動
| ルート | 役割 | データソース |
|---|---|---|
| `/accounts`(+`/[id]`,`/new`) | 顧客一覧/詳細/新規 | `getWorkspace` |
| `/srank`(+`/[id]`) | Sランク攻略（部署・キーパーソン） | `getWorkspace` + srank data |
| `/nurture` | 既存顧客深耕 | `getWorkspace` |
| `/contacts` | 担当者一覧 | `getWorkspace` |
| `/leads`(+`/[id]`,`/import`) | リード一覧/詳細/取込 | leads-workspace + `lead_metrics` |
| `/tasks` | タスク | `getWorkspaceLite` |
| `/activities` | 活動履歴 | `getWorkspace` |

### 3.4 分析
| ルート | 役割 | 集計方式 |
|---|---|---|
| `/analytics/revenue` | 売上・請求分析 | RPC/メモリ |
| `/analytics/roi` | 施策ROI分析 | RPC `channel_roi` |
| `/analytics/matrix` | 施策×顧客レベル | RPC `channel_level_matrix` |
| `/analytics/trends` | トレンド分析 | メモリ集計 |
| `/analytics/channels` | 流入元分析 | メモリ集計 |
| `/analytics/exhibitions` | 展示会分析(集客/成果) | RPC `exhibition_breakdown` |
| `/analytics/exhibition-roi` | 展示会 時系列/主催/テーマ + 売上・原価・ROI | RPC `exhibition_breakdown`/`exhibition_deal_roi` |
| `/analytics/exhibition-select` | 展示会選定 | 候補テーブル |
| `/analytics/seminars` | セミナー分析 | メモリ集計 |
| `/analytics/seminar-followup` | セミナー攻略リスト(過去接点クロス) | RPC `seminar_followup` |
| `/analytics/sales-reps` | 営業マン別 | メモリ集計 |
| `/analytics/products` | 商品別 | メモリ集計 |
| `/analytics/product-roi` | プロダクト収益分析 | RPC `product_profitability`/`subscription_metrics` |

### 3.5 設定
| ルート | 役割 |
|---|---|
| `/settings` | メンバー/テナント設定 |
| `/login` | ログイン（認証） |

---

## 4. データ取得・認可アーキテクチャ

### 4.1 認可（RLS）
- Supabase RLS。`current_tenant_ids()`（SECURITY DEFINER, memberships参照）を各ポリシーで使用。書込 `can_edit_role()`、閲覧範囲 `can_view_all()`。
- セッションは Cookie ベース（`getSession()` はネットワーク無し、middlewareで検証）。

### 4.2 ワークスペース一括取得（**パフォーマンスの中核**）
`src/lib/data/workspace.ts`:
- **`getWorkspace()`** → RPC `workspace_full`。**profiles/memberships/accounts/contacts/lead_sources/campaigns/products/opportunities/meetings/billing_schedules/activities/tasks/stage_histories/sales_targets/rep_targets/seminar_responses/lead_import_batches/acquirer_aliases を一括取得**。**16ページが使用**。
- **`getWorkspaceLite()`** → RPC `workspace_lite`。案件/KPI向けの軽量版（contacts/meetings/billing/activities/stage_histories/seminar/取込履歴を除外）。**14ページが使用**。
- 取得後、`Map` 化・ソートを毎回メモリで実施。
- `React.cache` で**同一リクエスト内**は1回に集約。ただし**ページ遷移ごと（別リクエスト）には再取得**。20ページが `force-dynamic` のためキャッシュ無効。

### 4.3 集計RPC（SECURITY DEFINER + 明示テナント + materialized CTE）
RLS再評価によるタイムアウト（authenticated=8s / anon=3s）を避けるため、重い集計はRPC化:
`lead_metrics` / `sales_actuals` / `channel_roi` / `channel_level_matrix` / `exhibition_breakdown` / `exhibition_deal_roi` / `product_profitability` / `subscription_metrics` / `seminar_followup` / `seminar_list` / `recompute_engagement` / `purge_tenant_opportunities`。
※ 2026-07-04 のセキュリティ強化(0040/0041)で、これら破壊的/分析RPCは **authenticated限定**、`search_path`固定済み。

### 4.4 主要テーブルとデータ規模（現況）
| テーブル | 規模 | 備考 |
|---|---|---|
| leads | 11.6 MB | 最大。2025-06以前含む |
| person_engagement | 5.5 MB | 接点集計 |
| touchpoints | 4.9 MB | 生接点 |
| opportunities | 1.1 MB / 681件 | 商談(Notion由来) |
| meetings | 933 KB / 626件 | 商談ログ(事前情報+議事録) |
| accounts | 458 KB | 顧客 |
| billing_schedules | 114 KB / 43件 | 請求/サブスク |
| revenue_forecasts | 98 KB | 来期受注見込み |

---

## 5. 更新系（Server Actions）

`src/server/actions.ts`（**1,894行**）に集約。主なもの:
- **案件**: createOpportunity / updateOpportunity / createMeeting / updateMeeting / createMtgAction / updateMtgAction
- **取込(全置換/バッチ)**: importNotionDeals / importLeadsBatch / importSeminarBatch / importDealCosts / importRevenueForecast
- **顧客/リード**: createAccount / createLead / updateLead / deleteLead / saveAccountNurture
- **分析マスタ**: saveChannel / saveChannelCost / saveProductMeta / saveExhibitionEvent / saveDealDetailCost
- **目標/KPI/レビュー**: saveTargets / saveRepTargets / saveKpiTargets / saveKpiActual / saveWeeklyReview / saveDeliveryReview / saveProjectReview / saveOppReviewExt / saveCampaignReviewExt
- **Sランク**: saveSrankDept / saveSrankKeyperson / updateSrankAccount / delete系

### 取込フロー（Notion商談）
1. CSVアップロード → `decodeFileText`(UTF-8/Shift_JIS) → `uniquifyHeaders`
2. `suggestDealMapping`（完全一致→部分一致の2パス）で列自動マッピング（手動修正可）
3. `importNotionDealsAction`: `purge_tenant_opportunities` で既存を全削除 → 250件チャンクで再投入。ヨミ→stage/status/forecast/probability変換、詳細→展示会ラベル正規化、事前情報+議事録を `meetings` に保存。

---

## 6. パフォーマンス特性（現状の実装）

- `next.config.mjs`: `experimental.staleTimes`（dynamic:180/static:300）でクライアント側の遷移キャッシュを一部有効化。
- `src/app/app/loading.tsx`: スケルトン表示。
- `/api/warm`: ウォームアップ用エンドポイント。
- **ボトルネック（実測ベースの構造的要因）**:
  1. `getWorkspace()` が案件+商談+請求+活動+履歴+セミナー等を**毎回全件JSONで転送→パース→Map化**（約2MB規模のペイロード）。ページで実際に使うのは一部でも全件取得。
  2. `force-dynamic` × 20ページ = サーバー側の再取得が毎遷移で発生。
  3. 一部分析（trends/channels/sales-reps/products/seminars/revenue）は**メモリ集計**で、データ増に比例して遅くなる。
  4. RLS配下の複数結合はタイムアウト境界に近く、RPC化で回避しているが未RPC化の画面が残る。

---

## 7. 運用データフロー（現状）

```
[架電・アポ獲得]  → スプレッドシート（手動管理）──CSV──┐
[商談・ステータス] → Notion「商談ヨミ表」──────CSV──┤
                                                    ↓
                                        CATORCE（全置換取込）
                                                    ↓
                                   閲覧・集計・分析（ダッシュボード/分析群）
```
- **入力の源泉は依然 Notion + スプレッドシート**。CATORCEは定期CSV取込で最新化する“分析ビュー”に近い。
- そのため「Notionを置き換える」段階には至っていない（＝日常入力がCATORCEで完結しない）。

---

## 8. 既知の課題（客観リスト）

| # | 領域 | 事実 | 影響 |
|---|---|---|---|
| C1 | IA | メニュー37項目、分析13・exec9で重複多数 | 目的の画面に辿り着けない／学習コスト |
| C2 | 性能 | 全業務データを毎回一括取得（16ページ）+ force-dynamic 20 | 初期表示が遅い |
| C3 | 性能 | 6画面がメモリ集計 | データ増で線形劣化 |
| C4 | 運用 | 案件はCSV全置換が主投入経路 | 日常のインライン編集・即時更新が弱い |
| C5 | 運用 | Notion/スプレッドシートが実入力元 | 二重管理・最新化ラグ |
| C6 | UI | 一覧の絞り込み/並べ替え/保存ビューが画面ごとにばらつき | Notion比で操作感が劣る |
| C7 | 保守 | actions.ts が1,894行の単一ファイル | 変更影響が読みにくい |

---

## 9. 変更履歴（ベースライン以降の主な追加：0026〜0041）

- 0026-0030: マーケ施策/チャネルコスト/プロダクト収益/顧客レベル(matrix)基盤
- 0031-0033: 展示会イベント/主催・テーマ prefill/成果クロス
- 0034-0036: 商談取込用カラム/purge RPC/請求nullable化
- 0037-0039: 受注見込み(revenue_forecasts)/展示会ROI/展示会ラベル統一
- 0040-0041: **セキュリティ強化**（バックアップ表RLS→削除、search_path固定、anon実行権限剥奪）
