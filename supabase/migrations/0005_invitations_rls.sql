-- =====================================================================
-- invitations テーブルの RLS(セキュリティ Advisor 対応)
-- 管理者(owner/admin)のみが参照・操作可能。
-- =====================================================================
alter table invitations enable row level security;

create policy invitations_admin on invitations for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
