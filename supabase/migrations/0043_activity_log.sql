-- WO-02: 活動履歴の刷新。要件書4.4のカラム追加 + 顧客の最終接触日/次回接触日 + タスク発生源。

alter table public.activities
  add column if not exists purpose text,
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

-- activities は created_at のみだったため updated_at トリガーを追加
drop trigger if exists set_updated_at_activities on public.activities;
create trigger set_updated_at_activities
  before update on public.activities
  for each row execute function public.set_updated_at();

-- 活動一覧の期間ソート用
create index if not exists idx_activities_tenant_date
  on public.activities(tenant_id, activity_at desc);

-- 顧客の接触状況（活動登録時に自動更新）
alter table public.accounts
  add column if not exists last_activity_date date,
  add column if not exists next_contact_date date;

-- タスクの発生源（manual/transition/schedule/followup7d 等）。既存は manual 扱い。
alter table public.tasks
  add column if not exists origin text not null default 'manual';
