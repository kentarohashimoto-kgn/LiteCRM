# WO-06: リードスコアリング＋ナーチャリング管理

> 前提: WO-00〜03完了（WO-04/05と並行可）。要件書4.9 / 4.10 / 4.11 / 11.4 対応。
> **目的**: 売上につながるリード条件をスコア化して初動の優先順位を自動化。今すぐ客でないリードの育成状態を管理する。

## DB変更（migration 0049）

### leads 拡張（MASTER_PLAN §4: rank/priority_score/funnel_stage等は既存再利用）
```sql
alter table public.leads
  add column if not exists lead_score integer,             -- 0-100（新方式）
  add column if not exists lead_score_detail jsonb,        -- 内訳 {size:15, role:20, issue:10, timing:5, fit:18}
  add column if not exists nurture_status text default 'not_started',  -- not_started/active/mql/sql/converted/unsubscribed
  add column if not exists first_contact_due_date date,
  add column if not exists converted_opportunity_id uuid references public.opportunities(id);
```

### lead_scoring_rules 新設（重み設定。要件書4.10の5軸）
```sql
create table public.lead_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  axis text not null,          -- size/role/issue/timing/fit
  match_kind text not null,    -- 'employee_gte'/'title_includes'/'text_includes'/'timing_band'/'interest_includes'
  match_value text not null,
  points integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
シード（要件書4.10の判定例を初期ルール化。点数上限: size20/role20/issue25/timing15/fit20）:
- size: employee_gte 1000→20 / 300→15 / 100→10 / 30→5
- role: title_includes 社長・代表→20, 役員・取締役・部長→15, 情シス・DX・人事→15, 課長→8
- issue: text_includes(needs/notes) AI導入→15, 効率化→10, 問い合わせ削減→15, 研修→10（複数該当は合算、上限25）
- timing: timing_band 1-3ヶ月→15, 半年→10, 来期→5
- fit: interest_includes 研修→15, 顧問→15, SUISHIN→20, Dify/RAG→15, 情シス→15（上限20）

### nurturing_campaigns / nurture_deliveries 新設（要件書4.11＋D10）
- nurturing_campaigns: 要件書4.11の項目どおり（phase: awareness/issue_awareness/consideration/internal_approval/reactivation）。
- nurture_deliveries: `id, tenant_id, lead_id, campaign_id, delivered_on date, channel text, result text, created_at`（**配信自体は外部ツール**。ここは実施記録。D10）。

## 実装詳細

### 1. スコアリングエンジン
- `src/lib/lead-scoring.ts`（純関数）: `scoreLead(lead, rules) → {score, detail, rank}`。軸ごとに合算し軸上限でクリップ、合計0-100。
- ランク閾値（要件書4.10）: 80+=S / 65+=A / 50+=B / 35+=C / それ未満=D。
- 初回接触期限: S=+1日 / A=+3営業日 / B=+7日 / C・D=なし。
- 実行タイミング: ①リード新規登録時 ②リード取込バッチ時（既存importLeadsBatchActionに組込み） ③`/app/leads` の「再スコアリング」ボタン（全件一括、RPC化: `rescore_leads()` — 大量leadsのためRPC必須）。
- **既存 `rank` 列との関係**: 新スコアのランクは既存rank列に書き込む（上書き注意 — 手動設定rankを保護するため、`lead_score_detail->>'manual'` フラグがある行はスキップ）。

### 2. リード詳細画面の再構成（要件書11.4）
- 基本情報 / ソース / **スコア・ランク（内訳の根拠つき）** / 推奨アクション（ランク別定型文: 要件書4.10表） / 初回接触期限（超過赤） / ナーチャリング状況 / 配信記録（nurture_deliveries一覧+追加） / **商談化ボタン**。
- 商談化ボタン: accounts突合（company_norm一致→既存紐付け、なければ作成）→ opportunities作成（lead引継ぎ: source/campaign/owner）→ lead.converted_at/converted_opportunity_id 更新 → 案件詳細へ遷移。

### 3. ナーチャリング管理画面 `/app/nurture-campaigns`
- キャンペーン一覧（phase別）・作成編集。対象リード抽出条件（rank/industry/interest）でプレビュー（該当リード数）。
- 「配信を記録」: 対象リードを選び delivered_on/channel/result を一括記録 → 各リードのnurture_status を更新。
- S/A発生アラート: sales_alerts に `hot_lead` 種別を追加（rank in S,A かつ first_contacted_at is null）→ マイダッシュボード表示。

### 4. 分析
- 本部ダッシュボード（WO-03）の「リードランク別商談化率」「ナーチャリング経由商談化数」を実装（RPC `lead_conversion_stats()`）。

## 受入基準（V-06）
- [ ] テストリード（大手・役員・AI導入・1-3ヶ月・SUISHIN関心）でスコア≧80・S判定・期限+1日
- [ ] スコア内訳が詳細画面に根拠付きで表示される
- [ ] 再スコアリングが全件で8s以内に完了（認証コンテキスト実測を報告。手動rank保護が効く）
- [ ] 商談化ボタン→顧客突合→案件作成→リードにconverted記録が一連で動く
- [ ] 配信記録→nurture_status更新→本部DBの商談化数集計に反映
- [ ] build/typecheck/advisors ERROR=0
