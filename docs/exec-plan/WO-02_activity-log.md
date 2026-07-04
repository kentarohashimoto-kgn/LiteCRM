# WO-02: 活動履歴の刷新（1活動1行・5分登録）

> 前提: WO-00, WO-01完了。要件書4.4 / 11.3 / 非機能13章「商談後5分以内に登録」対応。
> **目的**: メモ欄追記文化を廃し、活動を構造化。登録と同時に顧客・案件の最新状態を自動更新する。

## DB変更（migration 0044）
```sql
alter table public.activities
  add column if not exists purpose text,                        -- issue_discovery/proposal/budget_check/decision_maker_check/follow_up/upsell/relationship/other
  add column if not exists customer_reaction text,
  add column if not exists customer_quote text,
  add column if not exists discovered_issues text,
  add column if not exists upsell_opportunity text,
  add column if not exists budget_check_result text,
  add column if not exists decision_maker_check_result text,
  add column if not exists meeting_recording_url text,
  add column if not exists meeting_minutes_url text,
  add column if not exists ai_summary text,
  add column if not exists hq_comment text,
  add column if not exists updated_at timestamptz not null default now();
-- set_updated_at トリガー追加（activitiesは現状created_atのみ）
alter table public.accounts
  add column if not exists last_activity_date date,
  add column if not exists next_contact_date date;
alter table public.tasks
  add column if not exists origin text;                          -- 'manual'(既定)/'transition'/'schedule'/'followup7d' 等
```

## 実装詳細

### 1. 活動登録フォーム（要件書11.3の項目順を厳守）
- 新規: `/app/activities/new`（および案件詳細・顧客詳細からモーダル起動。`?account=&opp=`で事前選択）。
- 入力順: 顧客 → 案件(任意) → 活動日(既定=今日) → 活動種別 → 活動目的 → 活動内容 → 顧客反応 → 発掘課題 → 提案余地 → 予算確認 → 決裁者確認 → **次回AC日(必須)** → **次回AC内容(必須)** → 議事録URL → 保存。
- **必須は3つだけ**: 活動内容 / 次回AC日 / 次回AC内容（入力負荷を上げない。要件書16-2,16-3）。
- 顧客・案件はインクリメンタル検索セレクト（全件プルダウン禁止—件数が多い。`ilike`検索のserver actionで上位20件）。
- 「AI要約ボタン」はWO-07で追加（今回はプレースホルダー無しで省略）。

### 2. 登録時の自動更新（要件書4.4バリデーション/12章）
- `createActivityAction` 内でトランザクション的に:
  1. activities insert
  2. 関連 opportunity の `last_activity_at` / `next_action_date` / `next_action_text` を活動の値で更新（次回ACが入力された場合）
  3. 関連 account の `last_activity_date` / `next_contact_date` を更新
  4. `purpose='proposal'` の場合: **7日後フォロータスク自動作成**（tasks: title=「提案後フォロー: {顧客名}」, due=活動日+7日, origin='followup7d', assigned_to=活動担当）。同一案件に未完了の同originタスクがあれば重複作成しない。
- Supabase JSは複文トランザクション不可のため、この一連はRPC `log_activity(payload jsonb)` として実装（GUARDRAILSのRPCテンプレ準拠、can_edit_roleチェック込み）。

### 3. 活動一覧の改善
- `/app/activities`: 期間・顧客・担当・種別・目的でフィルタ（URLパラメータ）、ページング（WO-00方式）。
- 行展開で全文（反応/課題/提案余地/次回AC）を表示。案件・顧客へのリンク。

## 受入基準（V-02）
- [ ] 登録フォームが11.3の順で並び、必須3項目が空だと保存不可
- [ ] 登録→案件と顧客の last_activity / next_action が自動更新される
- [ ] purpose=提案 の活動登録→7日後dueのタスクが自動作成、重複作成されない
- [ ] 顧客検索セレクトが20件上限のインクリメンタル検索で動く
- [ ] ストップウォッチ計測で標準的な活動登録が5分以内に完了できる構成（報告に入力ステップ数を記載）
- [ ] build/typecheck/advisors ERROR=0
