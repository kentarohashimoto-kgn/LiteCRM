-- =====================================================================
-- プレゼンモード 分離の完全化: テナント列挙ヘルパーを「全て」プレゼン対応に。
--
-- 背景: 0153 で current_tenant_ids() のみプレゼン対応にしたが、RLSポリシーは
--   ロール別に view_all_tenant_ids() / edit_tenant_ids() / project_mgr_tenant_ids()
--   も使う。これらが未対応だったため、実テナントで owner/admin/sales_manager 等の
--   ユーザーはプレゼン中でも実データ(自テナント全件)が見えていた(営業マン別週報など)。
--
-- 対処: 判定を is_presentation_active() に一本化し、4つの列挙ヘルパー全てを
--   「プレゼン中はデモのみ / 通常時はデモ除外」に統一。membershipを直接参照する
--   2つのインラインポリシーも同じゲートを追加。
-- =====================================================================

create or replace function is_presentation_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from presentation_sessions p where p.user_id = auth.uid() and p.expires_at > now());
$$;

create or replace function current_tenant_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.tenant_id from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active'
    and t.is_demo = is_presentation_active();
$$;

create or replace function view_all_tenant_ids()
returns setof uuid language sql stable security definer set search_path to 'public','pg_temp' as $$
  select m.tenant_id from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner','admin','sales_manager','viewer')
    and t.is_demo = is_presentation_active();
$$;

create or replace function edit_tenant_ids()
returns setof uuid language sql stable security definer set search_path to 'public','pg_temp' as $$
  select m.tenant_id from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner','admin','sales_manager','sales_rep','external_sales')
    and t.is_demo = is_presentation_active();
$$;

create or replace function project_mgr_tenant_ids()
returns setof uuid language sql stable security definer set search_path to 'public','pg_temp' as $$
  select m.tenant_id from memberships m join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner','admin','sales_manager','finance','delivery')
    and t.is_demo = is_presentation_active();
$$;

-- membership を直接参照する2ポリシーにも同じゲートを追加。
drop policy if exists audit_events_select on audit_events;
create policy audit_events_select on audit_events for select using (
  exists (
    select 1 from memberships m join tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid() and m.tenant_id = audit_events.tenant_id and m.status = 'active'
      and m.role in ('owner','admin') and t.is_demo = is_presentation_active()
  )
);

drop policy if exists batch_job_settings_update on batch_job_settings;
create policy batch_job_settings_update on batch_job_settings for update using (
  tenant_id in (
    select m.tenant_id from memberships m join tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin') and t.is_demo = is_presentation_active()
  )
) with check (
  tenant_id in (
    select m.tenant_id from memberships m join tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin') and t.is_demo = is_presentation_active()
  )
);
