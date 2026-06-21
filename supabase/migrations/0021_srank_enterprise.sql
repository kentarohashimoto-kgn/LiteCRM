-- Sランク顧客(エンタープライズ)攻略: 会社単位攻略 + 部署 + キーマン。既存accountsを参照。
create table if not exists srank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  company_name text not null,
  srank_reason text, revenue_potential numeric, target_sales numeric, longterm_target numeric,
  deal_status text default 'none', stage text default 'S-01',
  exec_involved boolean default false, manager_involved boolean default false,
  priority_month text, exec_contact boolean default false, exec_contact_person text,
  exec_contact_route text, exec_theme text, company_issue text, next_upper_person text,
  intro_request_status text, next_exec_contact_date date, next_dept_contact_date date,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists srank_departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  srank_account_id uuid not null references srank_accounts(id) on delete cascade,
  name text not null, responsible text, keyperson text, decision_maker text, promoter text,
  issue text, interest_products text, budget_status text, timing text,
  proposal_status text default 'none', amount numeric default 0, expansion_potential text,
  next_action text, next_action_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists srank_keypersons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  srank_account_id uuid not null references srank_accounts(id) on delete cascade,
  name text not null, department text, title text, role text, influence text, relationship text,
  interest text, last_contact_date date, next_contact_date date, intro_depts text, concern text, next_request text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_srank_dept on srank_departments(srank_account_id);
create index if not exists idx_srank_kp on srank_keypersons(srank_account_id);
do $$
declare t text;
begin
  foreach t in array array['srank_accounts','srank_departments','srank_keypersons']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (tenant_id in (select current_tenant_ids()))', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_ins', t);
    execute format('create policy %I on %I for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_upd', t);
    execute format('create policy %I on %I for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_del', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t||'_updtrg', t);
  end loop;
end $$;
