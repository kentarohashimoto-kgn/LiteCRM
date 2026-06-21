-- 既存顧客深耕・アップセル管理。既存 accounts/opportunities を流用し、深耕管理を拡張テーブルで保持。
create table if not exists account_nurture (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  nurture_stage text not null default 'just_won',
  relationship text,
  deep_owner_user_id uuid references auth.users(id),
  next_contact_date date,
  additional_proposal text,
  expansion_depts text,
  exec_contact boolean default false,
  this_year_additional numeric,
  next_proposal text,
  services_done text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id)
);
create table if not exists nurture_touches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  touched_at date, method text, summary text, reaction text, next_date date,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_nt_acc on nurture_touches(account_id);
do $$
declare t text;
begin
  foreach t in array array['account_nurture','nurture_touches']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (tenant_id in (select current_tenant_ids()))', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_ins', t);
    execute format('create policy %I on %I for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_upd', t);
    execute format('create policy %I on %I for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_del', t);
  end loop;
end $$;
create trigger account_nurture_updtrg before update on account_nurture for each row execute function set_updated_at();
