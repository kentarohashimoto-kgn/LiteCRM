-- 来期受注見込み(計画)。期間にわたり売上が分散、確度で加重して売上予測に反映。
-- ロールバック: drop table revenue_forecasts;
create table if not exists revenue_forecasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  seq int, account_name text, product text, deal_name text, note text,
  period_label text, period_start date, period_end date,
  amount numeric, cost numeric, probability numeric,
  expected_order_date date, owner text, memo text,
  entered_on date, source_updated_on date, fy_start int,
  status text not null default 'active', import_source text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_rf_tenant on revenue_forecasts(tenant_id);
create index if not exists idx_rf_fy on revenue_forecasts(fy_start);
alter table revenue_forecasts enable row level security;
create policy rf_sel on revenue_forecasts for select using (tenant_id in (select current_tenant_ids()));
create policy rf_ins on revenue_forecasts for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy rf_upd on revenue_forecasts for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy rf_del on revenue_forecasts for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create trigger rf_updtrg before update on revenue_forecasts for each row execute function set_updated_at();
