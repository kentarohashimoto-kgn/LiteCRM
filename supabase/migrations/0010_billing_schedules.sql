-- =====================================================================
-- 案件の「分類」と「請求スケジュール(売上計画)」
--
-- 分類(category): development(開発) / advisory_subscription(顧問・サブスク)
--                 / training(研修) / other(その他)
--
-- billing_schedules: 受注日とは別に、請求(売上)の予定を行単位で管理。
--   kind='one_time'  … 請求予定日 + 請求額(複数行可。開発の都度請求/研修/その他)
--   kind='recurring' … 開始月〜終了月まで毎月 amount を請求(SES開発/顧問・サブスク)
-- =====================================================================

alter table opportunities add column if not exists category text;

create table if not exists billing_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  account_id uuid references accounts(id),
  kind text not null default 'one_time',          -- one_time / recurring
  billing_date date,                              -- one_time の請求予定日
  amount numeric not null default 0,              -- one_time:請求額 / recurring:月額
  recurring_start_month date,                     -- recurring 開始月(YYYY-MM-01)
  recurring_end_month date,                       -- recurring 終了月(YYYY-MM-01, 含む)
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_opp on billing_schedules(opportunity_id);
create index if not exists idx_billing_tenant on billing_schedules(tenant_id);

create trigger trg_billing_updated before update on billing_schedules for each row execute function set_updated_at();

alter table billing_schedules enable row level security;

create policy billing_select on billing_schedules for select
  using (
    tenant_id in (select current_tenant_ids()) and (
      can_view_all(tenant_id)
      or exists (select 1 from opportunities o where o.id = billing_schedules.opportunity_id and o.owner_user_id = auth.uid())
    )
  );
create policy billing_ins on billing_schedules for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy billing_upd on billing_schedules for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy billing_del on billing_schedules for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
