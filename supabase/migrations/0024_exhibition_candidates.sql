-- 展示会選定: 候補の評価(自動スコア/ランク)→幹部が最終決定。
create table if not exists exhibition_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  organizer text, name text not null, venue text, event_date date, days int default 1,
  status text not null default 'considering',
  has_seminar boolean default false, theme_fit text default 'mid',
  expected_visitors numeric, expected_leads numeric,
  booth_cost numeric default 0, staff_cost numeric default 0, other_cost numeric default 0,
  expected_deals numeric, expected_unit_price numeric, expected_revenue numeric,
  decision text not null default 'pending', notes text,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_exh_tenant on exhibition_candidates(tenant_id);
alter table exhibition_candidates enable row level security;
create policy exh_sel on exhibition_candidates for select using (tenant_id in (select current_tenant_ids()));
create policy exh_ins on exhibition_candidates for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy exh_upd on exhibition_candidates for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy exh_del on exhibition_candidates for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create trigger exh_updtrg before update on exhibition_candidates for each row execute function set_updated_at();
