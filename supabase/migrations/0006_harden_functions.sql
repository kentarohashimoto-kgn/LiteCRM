-- =====================================================================
-- 関数のセキュリティ強化(Advisor: function_search_path_mutable 対応)
-- search_path を固定し、トリガ専用関数の RPC 実行権限を剥奪する。
-- =====================================================================
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.log_stage_change() set search_path = public, pg_temp;
alter function public.current_tenant_ids() set search_path = public, pg_temp;
alter function public.current_role_in(uuid) set search_path = public, pg_temp;
alter function public.can_view_all(uuid) set search_path = public, pg_temp;
alter function public.can_edit_role(uuid) set search_path = public, pg_temp;

-- handle_new_user はトリガ専用。RPC経由の実行は不要なため権限剥奪。
revoke execute on function public.handle_new_user() from anon, authenticated, public;
