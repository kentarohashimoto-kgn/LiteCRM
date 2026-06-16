-- Phase2(マーケ): 既存campaignsを流用し、振り返りのみ拡張テーブルで保持
create table if not exists campaign_review_extensions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  review_week date,
  prep_status text not null default 'not_started',
  review_comment text,
  next_improvement text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id)
);
create table if not exists delivery_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid references accounts(id) on delete set null,
  project_name text,
  delivery_type text not null default 'training',
  execution_date date,
  instructor_user_id uuid references auth.users(id),
  participants_count int,
  satisfaction_score numeric,
  issue_flag boolean not null default false,
  issue_detail text,
  countermeasure text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists project_profit_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid references accounts(id) on delete set null,
  project_type text not null default 'dev',
  project_name text,
  contract_amount numeric not null default 0,
  planned_cost numeric not null default 0,
  actual_cost numeric not null default 0,
  forecast_cost numeric not null default 0,
  planned_gross_profit numeric,
  forecast_gross_profit numeric,
  quality_risk text,
  cost_risk text,
  continuation_status text,
  satisfaction_status text,
  countermeasure text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['campaign_review_extensions','delivery_reviews','project_profit_reviews']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (tenant_id in (select current_tenant_ids()))', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_ins', t);
    execute format('create policy %I on %I for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_upd', t);
    execute format('create policy %I on %I for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_del', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t||'_updtrg', t);
  end loop;
end $$;
