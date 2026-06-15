-- ダウンロード形式の保存(名前付きプリセット: UTAGE用 / 公式LINE用 / メルマガ用 等)
create table if not exists lead_export_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  columns text[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_lep_tenant on lead_export_presets(tenant_id);
alter table lead_export_presets enable row level security;
create policy lep_select on lead_export_presets for select using (tenant_id in (select current_tenant_ids()));
create policy lep_ins on lead_export_presets for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy lep_upd on lead_export_presets for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy lep_del on lead_export_presets for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
