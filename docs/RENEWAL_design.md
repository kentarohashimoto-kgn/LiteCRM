# CATORCE Sales OS — リニューアル設計書（施策/プロダクト/顧客レベル ROI分析基盤）

> 目的: 「①流入・施策軸 ②プロダクト軸 ③顧客レベル軸」で**ユニットエコノミクス（1件あたりの採算）**を測り、ポートフォリオとして資源配分（増資/改善/撤退）し、**顧客レベル別に重点ターゲットを選定**する経営分析基盤を構築する。
> 方針: 既存DB/UIを壊さない**加算的アプローチ**。マイグレーションは `0026` 以降。各追加にロールバック(`drop`)を併記。
> ベースライン: `docs/ARCHITECTURE_baseline_pre-renewal.md` / 復元点ブランチ `backup/pre-renewal-baseline`。

## 確定した前提（ユーザー合意事項）
1. 商品ごとの**原価/デリバリー工数を入力できる**（粗利の精度を担保）
2. **施策コストは営業管理担当者が月次で手入力**
3. 顧客レベルは「**規模帯（エンプラ/中堅/SMB）× ランク（S/A/B/C）**」で仮定義
4. アトリビューションは**ファーストタッチ**（最初の接点の施策に売上を帰属）
5. サブスクは**毎月手動更新**。解約は**解約フラグ＋解約日＋解約理由を手入力**する運用
6. ROI判定の**しきい値は仮決め**（後調整）

---

## 1. データモデル設計（追加・拡張）

### 1-1. 施策マスタ（階層）`marketing_channels`（新規 / 0026）
マインドマップの「カテゴリ＞施策＞サブ施策(枠)」を表現する自己参照ツリー。
| 列 | 型 | 説明 |
|---|---|---|
| id / tenant_id | uuid | |
| parent_id | uuid null | 自己参照（カテゴリ→施策→枠） |
| name | text | 例: 展示会 / アポ代行 / ライトアップ / エンプラ月2アポ |
| level | text | category / channel / slot |
| kind | text | self(自社) / agency(代理店) / advisor(顧問) / ad(広告) / organic / referral / event |
| cost_model | text | fixed_monthly / per_result / one_time / none |
| default_monthly_cost | numeric | 月額固定費の既定 |
| per_result_cost | numeric | 成果報酬単価（例: 1アポ単価） |
| committed_metric | text | コミット指標（例: appointments） |
| committed_qty | numeric | コミット量（例: 5＝月5アポ） |
| target_level | text | 想定顧客レベル（enterprise/mid/smb など、ヒント用） |
| priority_flag | bool | 重点(❗) |
| status / sort_order / notes / timestamps | | |

- 既存 `lead_sources` / `campaigns` との関係: `campaigns.marketing_channel_id`(追加, null可) と `lead_sources` → channel のマッピングを用意。**campaignsは「施策の実施回（展示会の各開催）」、marketing_channelsは「施策そのもの（マスタ）」**として役割分担。
- RLS: 既存テーブル同様 `current_tenant_ids()` + `can_edit_role()`。
- ロールバック: `drop table marketing_channels cascade;`

### 1-2. 施策コスト月次台帳 `channel_costs`（新規 / 0026）
ROI算出の生命線。**営業管理担当者が月次入力**（前提2）。
| 列 | 型 | 説明 |
|---|---|---|
| id / tenant_id | uuid | |
| channel_id | uuid | → marketing_channels |
| month | date | YYYY-MM-01 |
| fixed_cost | numeric | 当月固定費 |
| variable_cost | numeric | 当月成果報酬等（per_result×実績で自動算出も可） |
| result_qty | numeric null | 実績量（例: 実アポ数）→ コミット未達アラート用 |
| memo / created_by / timestamps | | |
- 一意制約: `(tenant_id, channel_id, month)`。
- ロールバック: `drop table channel_costs;`

### 1-3. アトリビューション列（ファーストタッチ / 0026）
- `leads.marketing_channel_id`(追加, null可) … 取込時に lead_source/campaign から付与。
- `opportunities.marketing_channel_id`(追加, null可) … 由来リードから継承（無ければ lead_source/campaign から）。
- 初期バックフィル: 既存 lead_source/campaign → channel のマッピングで一括設定するデータマイグレーション。
- ロールバック: `alter table ... drop column marketing_channel_id;`

### 1-4. プロダクト拡張 `products`（列追加 / 0028）
既存に `category_id, category, default_price, default_gross_profit_rate, is_recurring, release_date` あり。追加:
| 追加列 | 型 | 説明 |
|---|---|---|
| product_type | text | training / b2c / subscription / consulting / non_ai / oxin |
| unit_cost | numeric | 標準原価（前提1） |
| delivery_hours | numeric | 標準デリバリー工数（前提1） |
| priority_flag | bool | 重点(❗) |
| derived_from_product_id | uuid null | 派生/横展開元（例: 法人品質研修 ← バイブコーディング） |
- 案件単位の実原価/粗利は既存 `opportunity_products.gross_profit` を正とし、`unit_cost`は既定値。
- ロールバック: 追加列を `drop column`。

### 1-5. サブスク解約 `billing_schedules`（列追加 / 0028）
既存に `recurring_start_month, recurring_end_month` あり。手動運用（前提5）のため追加:
| 追加列 | 型 | 説明 |
|---|---|---|
| sub_status | text | active / canceled（recurring行のみ） |
| canceled_month | date null | 解約月 |
| cancel_reason | text null | 解約理由 |
- MRR(月) = その月に有効な recurring 金額合計（start≤月≤end かつ canceled前）。Churn(月) = その月に canceled になった金額/件数。
- ロールバック: 追加列を `drop column`。

### 1-6. 顧客レベル定義（前提3・仮 / ロジック層）
- 規模帯: `employee_size` から `enterprise(1000名以上) / mid(100〜1000) / smb(〜100)`。
- ランク: `leads.rank` / `accounts.engagement_rank` の S/A/B/C。
- レベル = 規模帯 × ランク（例: enterprise-A）。まずは**計算ロジック**（`src/lib/customer-level.ts`）で実装し、しきい値は `tenant_settings` で後から調整可能に。DBスキーマ追加は当面なし。

---

## 2. 集計RPC（すべて SECURITY DEFINER + 明示テナントフィルタ + materialized CTE）
> 教訓: `security invoker` の多結合RPCはRLS再評価で認証ロールのstatement_timeout(8s)を超過する。`seminar_followup` と同様に **DEFINER + `tenant_id = any(current_tenant_ids())` 明示** + `as materialized` で実装する。

| RPC | 入力 | 返り値(jsonb) |
|---|---|---|
| `channel_roi(p_start, p_end)` | 期間/年度 | 施策別: cost(fixed+variable), leads/appts/deals/won, revenue, gross_profit, CAC, ROI, payback, LTV/CAC, 顧客レベル内訳 |
| `product_profitability(p_start, p_end)` | 期間 | 商品別: deals, revenue, gross_profit, margin。recurring は MRR/ARR/churn/LTV |
| `subscription_metrics(p_start, p_end)` | 期間 | 月別 MRR / 新規MRR / 解約MRR / チャーン率 / 継続数 / アクティブ数 |
| `channel_level_matrix(p_start, p_end)` | 期間 | 施策 × 顧客レベル のセル（deals/revenue/LTV/ROI）→ ヒートマップ |
- ROI = (gross_profit − cost) / cost。CAC = cost / 新規顧客数。Payback = CAC / 月次粗利。
- アトリビューションはファーストタッチ（`marketing_channel_id`）。

---

## 3. 画面要件
| ルート(新規/拡張) | 内容 |
|---|---|
| `/analytics/roi`（新規） | **施策ROIダッシュボード**: 4象限ポートフォリオ(規模×ROI)、施策別一覧(コスト/CAC/ROI/回収)、ファネル転換率、年度/期間・対象範囲(受注/Aヨミ/Bヨミ)フィルタ、Good/Watch/Bad色分け |
| `/analytics/product-roi`（新規） | **プロダクト収益**: 4象限、商品別粗利率、サブスクMRR/チャーン/LTV、重点(❗)・派生関係の可視化 |
| `/analytics/matrix`（新規） | **施策×顧客レベル×商品クロス**ヒートマップ＋ドリルダウン |
| `/exec/marketing`（拡張） | 営業管理担当の**月次コスト入力**フォーム＋ROIサマリー連携 |
| 設定 or 各画面内（新規） | **施策マスタ/商品マスタ拡張**の編集UI（階層・コストモデル・原価・重点フラグ・派生） |
| `/exec`（拡張） | コミット未達/ROI悪化/解約増の**アラート**を週次サマリーに表示 |
- 全画面で**ドリルダウン**（施策/商品 → 該当リード/案件一覧）。`export const dynamic = "force-dynamic"`。

---

## 4. 運用設計（週次/月次）
| サイクル | 指標 | 入力/担当 |
|---|---|---|
| 週次 | リード/アポ/商談化/パイプライン/コミット消化 | 自動集計 |
| 月次 | 受注/売上/粗利/ROI/CAC/MRR/チャーン/ポートフォリオ | **施策コスト・解約は営業管理担当が手入力**、他は自動 |

---

## 5. 段階的実装（マイグレーション付き）
| Phase | マイグレーション | 内容 |
|---|---|---|
| **P1: 施策ROI** | `0026`(marketing_channels, channel_costs, attribution列, backfill), `0027`(RPC channel_roi) | `/analytics/roi` ＋ マーケ施策管理にコスト入力。**最も経営インパクト大** |
| **P2: 商品収益** | `0028`(products拡張, billing_schedules拡張, RPC product_profitability/subscription_metrics) | `/analytics/product-roi` |
| **P3: クロス分析** | `0029`(RPC channel_level_matrix) ＋ `customer-level.ts` | `/analytics/matrix` ＋ 重点ターゲット設計 |
| **P4: 自動化** | `0030`(任意: しきい値設定 tenant_settings) | アラート・自動Good/Watch/Bad・週次月次統合 |
- 各マイグレーションのファイル冒頭にロールバックSQLをコメントで併記。

## 6. リスク・留意点
- **アトリビューション精度**: ファーストタッチのため、既存データの lead_source/campaign 欠損があると施策別ROIがブレる → backfill時に欠損率をログ出力。
- **コスト入力の運用定着**: channel_costs が埋まらないとROIが出ない → 入力UIを簡素化し、未入力月を可視化。
- **パフォーマンス**: 新RPCは必ず DEFINER + 明示テナント + materialized（seminar_followupの教訓）。EXPLAINで認証ロール相当の実測を行う。
- **顧客レベルの仮定義**: 規模帯×ランクは仮。運用後にしきい値・粒度を見直す。

## 7. 次アクション
本設計でPhase1から着手してよければ、`0026`(marketing_channels / channel_costs / attribution + backfill) のマイグレーションと `/analytics/roi` の実装から始める。
