-- =====================================================================
-- CATORCE Sales OS - Row Level Security (要件 14章)
-- 方針:
--   - 全業務テーブルで RLS 有効化
--   - ログインユーザーが所属する tenant_id のデータのみアクセス可能
--   - owner/admin/sales_manager/viewer は tenant 内全件参照
--   - sales_rep/external_sales/partner 等は自分が owner のデータ中心
-- =====================================================================

-- ヘルパー: 現在ユーザーが所属する tenant_id 一覧
create or replace function current_tenant_ids()
returns setof uuid language sql stable security definer as $$
  select tenant_id from memberships
  where user_id = auth.uid() and status = 'active';
$$;

-- ヘルパー: 指定テナントでの現在ユーザーのロール
create or replace function current_role_in(p_tenant uuid)
returns text language sql stable security definer as $$
  select role from memberships
  where user_id = auth.uid() and tenant_id = p_tenant and status = 'active'
  limit 1;
$$;

-- ヘルパー: そのテナントで全件閲覧できるロールか
create or replace function can_view_all(p_tenant uuid)
returns boolean language sql stable as $$
  select current_role_in(p_tenant) in ('owner','admin','sales_manager','viewer');
$$;

-- ヘルパー: 編集可能ロールか
create or replace function can_edit_role(p_tenant uuid)
returns boolean language sql stable as $$
  select current_role_in(p_tenant) in ('owner','admin','sales_manager','sales_rep','external_sales');
$$;

-- ---- RLS 有効化 ----
alter table tenants enable row level security;
alter table tenant_settings enable row level security;
alter table memberships enable row level security;
alter table lead_sources enable row level security;
alter table product_categories enable row level security;
alter table products enable row level security;
alter table accounts enable row level security;
alter table contacts enable row level security;
alter table campaigns enable row level security;
alter table leads enable row level security;
alter table opportunities enable row level security;
alter table opportunity_products enable row level security;
alter table activities enable row level security;
alter table tasks enable row level security;
alter table stage_histories enable row level security;
alter table opportunity_change_logs enable row level security;
alter table forecast_snapshots enable row level security;
alter table sales_targets enable row level security;
alter table audit_logs enable row level security;

-- ---- tenants / memberships ----
create policy tenant_select on tenants for select
  using (id in (select current_tenant_ids()));

create policy membership_select on memberships for select
  using (tenant_id in (select current_tenant_ids()));
create policy membership_admin on memberships for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- ---- マスタ系: テナント内は全員参照、管理者のみ編集 ----
do $$
declare t text;
begin
  foreach t in array array['lead_sources','product_categories','products','campaigns','tenant_settings','sales_targets','forecast_snapshots'] loop
    execute format('create policy %1$s_select on %1$s for select using (tenant_id in (select current_tenant_ids()));', t);
    execute format('create policy %1$s_write on %1$s for all using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in (''owner'',''admin'',''sales_manager'')) with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in (''owner'',''admin'',''sales_manager''));', t);
  end loop;
end $$;

-- ---- accounts / contacts: 全件閲覧ロールは全件、それ以外は自分担当の商談/リードに関連するもの ----
create policy accounts_select on accounts for select
  using (
    tenant_id in (select current_tenant_ids()) and (
      can_view_all(tenant_id)
      or owner_user_id = auth.uid()
      or exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = auth.uid())
    )
  );
create policy accounts_write on accounts for all
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

create policy contacts_select on contacts for select
  using (
    tenant_id in (select current_tenant_ids()) and (
      can_view_all(tenant_id)
      or exists (select 1 from opportunities o where o.account_id = contacts.account_id and o.owner_user_id = auth.uid())
    )
  );
create policy contacts_write on contacts for all
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- leads / opportunities: 全件 or 自分が owner ----
create policy leads_select on leads for select
  using (tenant_id in (select current_tenant_ids()) and (can_view_all(tenant_id) or owner_user_id = auth.uid()));
create policy leads_write on leads for all
  using (tenant_id in (select current_tenant_ids()) and (can_view_all(tenant_id) or owner_user_id = auth.uid()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

create policy opps_select on opportunities for select
  using (tenant_id in (select current_tenant_ids()) and (can_view_all(tenant_id) or owner_user_id = auth.uid()));
create policy opps_write on opportunities for all
  using (tenant_id in (select current_tenant_ids()) and (can_view_all(tenant_id) or owner_user_id = auth.uid()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- 商談に従属するテーブル ----
create policy opp_products_select on opportunity_products for select
  using (exists (select 1 from opportunities o where o.id = opportunity_id));
create policy opp_products_write on opportunity_products for all
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

create policy activities_select on activities for select
  using (
    tenant_id in (select current_tenant_ids()) and (
      can_view_all(tenant_id) or owner_user_id = auth.uid()
      or exists (select 1 from opportunities o where o.id = activities.opportunity_id and o.owner_user_id = auth.uid())
    )
  );
create policy activities_write on activities for all
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

create policy tasks_select on tasks for select
  using (tenant_id in (select current_tenant_ids()) and (can_view_all(tenant_id) or assigned_to = auth.uid() or created_by = auth.uid()));
create policy tasks_write on tasks for all
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

create policy stage_hist_select on stage_histories for select
  using (tenant_id in (select current_tenant_ids()));
create policy stage_hist_insert on stage_histories for insert
  with check (tenant_id in (select current_tenant_ids()));

create policy opp_changelog_select on opportunity_change_logs for select
  using (tenant_id in (select current_tenant_ids()));
create policy opp_changelog_insert on opportunity_change_logs for insert
  with check (tenant_id in (select current_tenant_ids()));

-- ---- 監査ログ: 管理者のみ参照 ----
create policy audit_select on audit_logs for select
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
create policy audit_insert on audit_logs for insert
  with check (tenant_id in (select current_tenant_ids()));
