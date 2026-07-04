# WO-04: 既存顧客アカウント営業（深耕・お土産・トランジション）

> 前提: WO-00〜03完了。要件書4.1 / 4.5 / 4.6 / 4.7 / 5.1 / 5.2 対応。**要件書16-4「最重要機能」**。
> **目的**: 研修ワンショットで終わらせない。ランク別接触・お土産提案・研修後トランジションを仕組み化。

## DB変更（migration 0046〜0047）

### accounts 拡張（要件書4.1の差分。MASTER_PLAN §4のマッピング厳守 — rank/potential/industry等は既存再利用）
```sql
alter table public.accounts
  add column if not exists account_type text default 'new',       -- new/existing/partner/lost/dormant
  add column if not exists executive_owner_id uuid references public.profiles(id),
  add column if not exists contact_frequency_rule text,           -- monthly/bimonthly/quarterly/semiannual/none
  add column if not exists current_ai_usage_status text,
  add column if not exists unresolved_issues text;
```
- ランク別既定接触ルール（要件書4.1表）: S=monthly / A=bimonthly / B=quarterly / C=semiannual / dormant=none。rank変更時にcontact_frequency_ruleが空なら既定値をセット（server action内）。

### account_nurture 拡張 → アカウントプラン化（D8。新テーブルは作らない）
```sql
alter table public.account_nurture
  add column if not exists business_pain text,
  add column if not exists department_pains text,
  add column if not exists satisfaction_level text,
  add column if not exists next_solution_candidate_2 text,   -- 候補1は既存 next_proposal を再利用
  add column if not exists next_solution_candidate_3 text,
  add column if not exists souvenir_package_id uuid,
  add column if not exists souvenir_proposal_date date,
  add column if not exists customer_reaction text,
  add column if not exists budget_status text,
  add column if not exists decision_maker_status text,
  add column if not exists next_action_text text,
  add column if not exists hq_advice text,
  add column if not exists health_status text;               -- healthy/attention/risk/inactive
```

### solution_packages 新設＋5種シード（要件書4.6の表を`初期提案内容/次の展開/提案タイミング`まで忠実にINSERT）
```sql
create table public.solution_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  package_name text not null,
  package_category text not null,        -- elearning/chatbot/suishin/it_solution/development/other
  target_customer text, target_department text,
  customer_benefit text not null,
  proposal_timing text, initial_offer_detail text, next_expansion text,
  standard_price numeric, proposal_template_url text, sales_script text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
シード5種: AI学習eラーニング / AI回答チャットボット・サポートデスク / SUISHIN(7月末ローンチ) / 情報システム向けAIソリューションパック(CTCSP協業) / AI活用システム開発・保守。
（RLS4点＋トリガー。`opportunities.solution_package_id` にFK付与）

### transitions 新設（要件書4.7）
- 要件書4.7の項目どおり（followup_3days_status / followup_2weeks_status / proposal_30days_status は `not_started/done/overdue`）。RLS4点＋トリガー。

## 実装詳細

### 1. トランジション自動作成＋自動タスク（要件書5.2）
- `updateOpportunityAction`（＋ヨミインライン変更）で **category='training' または 'development' の案件が won になった時**、transitions を自動作成（既存があればスキップ）。
- 作成時に tasks を3件自動生成（origin='transition'）:
  - +3営業日: 「御礼・アンケート要約・成果サマリー送付」
  - +2週間: 「活用定着MTG」
  - +30日: 「お土産提案（eラーニング/回答AI/SUISHIN）」
  - +90日: 「部署展開・顧問化提案」
- 営業日計算は土日スキップの簡易実装（祝日は考慮しない。コメントで明記）。
- delivery_date 入力時に各タスクのdueを研修日基準で再計算。

### 2. アカウントプラン画面 `/app/accounts/plan`（既存 /app/nurture を改称・拡張）
- 一覧: S/A/B/C/dormantタブ、各顧客の「最終接触 / 接触期限(ルール由来) / ヘルス / 次提案候補 / お土産提案状況 / 次回AC」。
- ヘルス判定（要件書4.5表）はRPCまたはフェッチャ内で算出:
  healthy=期限内接触あり＋課題更新あり＋次提案あり / attention=接触ありだが課題・次提案未更新 / risk=接触期限超過 / inactive=90日無接触＋次回ACなし。
- 行クリック→プラン編集（課題/部門別課題/満足度/次提案候補1-3/お土産(パッケージ選択+提案日+反応)/予算/決裁者/次回AC/本部アドバイス）。

### 3. お土産提案の記録と案件化
- プランから「お土産提案を記録」→ souvenir_package_id/date 保存 + activities に purpose='upsell' の活動を自動起票。
- 「アップセル案件を作成」ボタン→ opportunities 新規（opportunity_type='existing_upsell', solution_package_id 引継ぎ）。

### 4. 顧客詳細画面の再構成（要件書11.1の14セクション）
- 基本情報 / ランク・ポテンシャル / 担当者 / 過去売上(集計RPC) / 過去納品 / 課題・未解決課題 / 次提案候補 / お土産履歴 / 活動履歴 / 案件一覧 / トランジション / 次回AC / 本部コメント。

### 5. WO-03のアラート・本部ダッシュボードの有効化
- transitions 系アラート（3日フォロー/30日提案）と「お土産提案数」「研修後30日以内アップセル提案率」を実データで表示。

## 受入基準（V-04）
- [ ] 研修案件をwonへ変更→transitionが自動作成され、タスク4件が正しいdueで生成
- [ ] 同じ案件を再度保存してもtransition/タスクが重複しない
- [ ] アカウントプラン一覧でヘルス4状態が定義どおり判定される（各状態のテストデータで確認し報告）
- [ ] お土産提案の記録→活動が自動起票され、本部DBの「お土産提案数」が増える
- [ ] solution_packages に5種がシードされ、設定画面等から編集可能
- [ ] S顧客30日未接触が sales_alerts に出る
- [ ] build/typecheck/advisors ERROR=0
