-- 全社の月間目標を「担当×流入元」に配分する。担当分は rep_targets(→営業マン別週報の目標)へ反映。
create table if not exists public.target_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  target_month text not null,                         -- YYYY-MM
  owner_user_id uuid references auth.users(id),        -- 担当(nullなら流入元/その他のみの配分)
  lead_source_id uuid references lead_sources(id) on delete set null,
  label text,                                          -- パートナー/その他 等の自由ラベル
  amount numeric not null default 0,
  sort_order int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_target_alloc_tenant_month on public.target_allocations(tenant_id, target_month, sort_order);

alter table public.target_allocations enable row level security;

drop policy if exists target_alloc_select on public.target_allocations;
drop policy if exists target_alloc_insert on public.target_allocations;
drop policy if exists target_alloc_update on public.target_allocations;
drop policy if exists target_alloc_delete on public.target_allocations;

-- 目標は社内で共有(閲覧はテナント全員)。設定(書込)は管理ロールのみ。
create policy target_alloc_select on public.target_allocations for select
  using (tenant_id in (select current_tenant_ids()));
create policy target_alloc_insert on public.target_allocations for insert
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));
create policy target_alloc_update on public.target_allocations for update
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));
create policy target_alloc_delete on public.target_allocations for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));

drop trigger if exists trg_target_alloc_updated_at on public.target_allocations;
create trigger trg_target_alloc_updated_at before update on public.target_allocations
  for each row execute function public.set_updated_at();
