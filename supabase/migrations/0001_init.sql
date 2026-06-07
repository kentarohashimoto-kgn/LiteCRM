-- =====================================================================
-- CATORCE Sales OS - 初期スキーマ (MVP)
-- 要件定義書 12章 / 13章 に対応。マルチテナント前提で全業務テーブルに
-- tenant_id を持たせる。
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---- 共通: updated_at 自動更新トリガ ----
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- =====================================================================
-- SaaS基盤系
-- =====================================================================
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'sales_rep',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, user_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role text not null default 'sales_rep',
  status text not null default 'pending',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- =====================================================================
-- マスタ
-- =====================================================================
create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  category_id uuid references product_categories(id),
  category text,
  name text not null,
  description text,
  default_price numeric,
  default_gross_profit_rate numeric,
  is_recurring boolean not null default false,
  status text not null default 'active',
  release_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- CRM/SFA
-- =====================================================================
create table accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid references auth.users(id),
  name text not null,
  industry text,
  employee_size text,
  revenue_size text,
  area text,
  status text not null default 'prospect',
  priority text,
  potential text,
  website_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  department text,
  title text,
  email text,
  phone text,
  decision_role text,
  interest_topics text[],
  temperature text,
  last_contacted_at timestamptz,
  next_contact_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  lead_source_id uuid references lead_sources(id),
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references accounts(id),
  contact_id uuid references contacts(id),
  lead_source_id uuid references lead_sources(id),
  campaign_id uuid references campaigns(id),
  owner_user_id uuid references auth.users(id),
  primary_product_id uuid references products(id),
  title text not null,
  status text not null default 'new',
  rank text,
  acquired_at date not null default current_date,
  first_contacted_at timestamptz,
  converted_at timestamptz,
  disqualified_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references accounts(id),
  contact_id uuid references contacts(id),
  lead_id uuid references leads(id),
  owner_user_id uuid not null references auth.users(id),
  name text not null,
  stage text not null default 'lead_acquired',
  forecast_category text not null default 'pipeline',
  amount numeric not null default 0,
  gross_profit numeric,
  gross_profit_rate numeric,
  probability integer not null default 10 check (probability >= 0 and probability <= 100),
  expected_close_date date,
  expected_revenue_month date,
  primary_product_id uuid references products(id),
  lead_source_id uuid references lead_sources(id),
  next_action_date date,
  next_action_text text,
  last_activity_at timestamptz,
  status text not null default 'open',
  lost_reason text,
  win_reason text,
  risk_level text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table opportunity_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  product_id uuid not null references products(id),
  amount numeric not null default 0,
  gross_profit numeric,
  quantity integer not null default 1,
  created_at timestamptz not null default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references accounts(id),
  contact_id uuid references contacts(id),
  opportunity_id uuid references opportunities(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  activity_type text not null,
  title text not null,
  body text,
  activity_at timestamptz not null default now(),
  next_action_date date,
  next_action_text text,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  account_id uuid references accounts(id),
  assigned_to uuid not null references auth.users(id),
  created_by uuid not null references auth.users(id),
  title text not null,
  description text,
  due_date date not null,
  status text not null default 'todo',
  priority text default 'middle',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- 分析・予測
-- =====================================================================
create table stage_histories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by uuid references auth.users(id),
  reason text,
  changed_at timestamptz not null default now()
);

create table opportunity_change_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  field text not null,
  before_value text,
  after_value text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create table forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  snapshot_date date not null default current_date,
  period_month date not null,
  commit_amount numeric not null default 0,
  best_case_amount numeric not null default 0,
  pipeline_amount numeric not null default 0,
  upside_amount numeric not null default 0,
  weighted_amount numeric not null default 0,
  target_amount numeric not null default 0,
  gap_amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create table sales_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  target_month date not null,
  target_amount numeric not null default 0,
  target_gross_profit numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, target_month)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- インデックス
-- =====================================================================
create index idx_accounts_tenant on accounts(tenant_id);
create index idx_contacts_account on contacts(account_id);
create index idx_leads_tenant_owner on leads(tenant_id, owner_user_id);
create index idx_opps_tenant_owner on opportunities(tenant_id, owner_user_id);
create index idx_opps_stage on opportunities(tenant_id, stage);
create index idx_opps_close on opportunities(tenant_id, expected_close_date);
create index idx_activities_opp on activities(opportunity_id);
create index idx_tasks_assignee on tasks(tenant_id, assigned_to, status);
create index idx_stage_hist_opp on stage_histories(opportunity_id);

-- ---- updated_at トリガ ----
create trigger trg_tenants_updated before update on tenants for each row execute function set_updated_at();
create trigger trg_memberships_updated before update on memberships for each row execute function set_updated_at();
create trigger trg_accounts_updated before update on accounts for each row execute function set_updated_at();
create trigger trg_contacts_updated before update on contacts for each row execute function set_updated_at();
create trigger trg_products_updated before update on products for each row execute function set_updated_at();
create trigger trg_lead_sources_updated before update on lead_sources for each row execute function set_updated_at();
create trigger trg_leads_updated before update on leads for each row execute function set_updated_at();
create trigger trg_opps_updated before update on opportunities for each row execute function set_updated_at();
create trigger trg_tasks_updated before update on tasks for each row execute function set_updated_at();
create trigger trg_sales_targets_updated before update on sales_targets for each row execute function set_updated_at();

-- ---- ステージ変更を stage_histories に自動記録 ----
create or replace function log_stage_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'UPDATE' and new.stage is distinct from old.stage) then
    insert into stage_histories(tenant_id, opportunity_id, from_stage, to_stage, changed_by)
    values (new.tenant_id, new.id, old.stage, new.stage, auth.uid());
  end if;
  return new;
end; $$;

create trigger trg_opp_stage_log after update on opportunities for each row execute function log_stage_change();
