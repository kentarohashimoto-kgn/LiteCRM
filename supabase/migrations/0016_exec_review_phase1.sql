-- 週次幹部MTG支援(経営レビュー) Phase1。既存DBは参照のみ、振り返り系は新規テーブルで管理。
create table if not exists weekly_kpi_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  target_month date not null,
  target_week int not null default 0,
  department text not null default 'sales',
  kpi_type text not null,
  monthly_target numeric not null default 0,
  weekly_target numeric not null default 0,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, target_month, target_week, department, kpi_type)
);
create table if not exists weekly_kpi_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  target_id uuid not null references weekly_kpi_targets(id) on delete cascade,
  actual_value numeric not null default 0,
  actual_source text not null default 'manual',
  source_memo text,
  input_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_id)
);
create table if not exists weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  target_id uuid references weekly_kpi_targets(id) on delete cascade,
  result_id uuid references weekly_kpi_results(id) on delete set null,
  evaluation text,
  system_comment text,
  human_comment text,
  root_cause text,
  countermeasure text,
  owner_user_id uuid references auth.users(id),
  due_date date,
  status text not null default 'open',
  next_check_point text,
  result_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_id)
);
create table if not exists mtg_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  meeting_date date,
  title text not null,
  description text,
  department text,
  related_type text,
  related_id uuid,
  owner_user_id uuid references auth.users(id),
  due_date date,
  priority text not null default 'middle',
  status text not null default 'open',
  completion_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists opportunity_review_extensions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  existing_opportunity_id uuid not null references opportunities(id) on delete cascade,
  review_week date,
  read_up_plan text,
  closing_plan text,
  blocking_issue text,
  executive_comment text,
  next_check_point text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (existing_opportunity_id)
);
do $$
declare t text;
begin
  foreach t in array array['weekly_kpi_targets','weekly_kpi_results','weekly_reviews','mtg_actions','opportunity_review_extensions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (tenant_id in (select current_tenant_ids()))', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_ins', t);
    execute format('create policy %I on %I for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_upd', t);
    execute format('create policy %I on %I for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_del', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t||'_updtrg', t);
  end loop;
end $$;
