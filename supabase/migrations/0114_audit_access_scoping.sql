-- セキュリティ監査(2026-07-12)対応③: 越権アクセスの修正。
-- (a) global_search: SECURITY DEFINER でテナントのみ絞り owner スコープを無視していた
--     → SECURITY INVOKER に変更し、RLS(担当スコープ)を自然に適用。external_sales の全件検索露出を封鎖。
alter function public.global_search(text) security invoker;

-- (b) weekly_report_snapshots: 全社の財務集計(payload)を含むため、閲覧を can_view_all ロールに限定。
--     (external_sales は自分担当のみが原則=要件11.2。全社スナップは管理側の画面)
drop policy if exists weekly_snap_select on public.weekly_report_snapshots;
create policy weekly_snap_select on public.weekly_report_snapshots for select using (
  (tenant_id in (select current_tenant_ids())) and can_view_all(tenant_id)
);
-- 削除も管理ロールに限定(従来は can_edit_role=external_sales含む)
drop policy if exists weekly_snap_delete on public.weekly_report_snapshots;
create policy weekly_snap_delete on public.weekly_report_snapshots for delete using (
  (tenant_id in (select current_tenant_ids())) and current_role_in(tenant_id) in ('owner','admin','sales_manager')
);

-- (c) weekly_rep_reports: 他営業の週報ナラティブは本人 or 管理側のみ閲覧可。削除は管理側のみ。
drop policy if exists rep_report_select on public.weekly_rep_reports;
create policy rep_report_select on public.weekly_rep_reports for select using (
  (tenant_id in (select current_tenant_ids()))
  and ((owner_user_id = (select auth.uid())) or can_view_all(tenant_id))
);
drop policy if exists rep_report_delete on public.weekly_rep_reports;
create policy rep_report_delete on public.weekly_rep_reports for delete using (
  (tenant_id in (select current_tenant_ids())) and current_role_in(tenant_id) in ('owner','admin','sales_manager')
);

-- (d) 共有ナレッジ(knowledge/playbooks/content)は「閲覧=テナント全員(意図どおり)」を維持しつつ、
--     削除を「作成者本人 or 管理ロール」に限定(external_sales が他人の資産を消せないように)。
drop policy if exists knowledge_delete on public.knowledge_entries;
create policy knowledge_delete on public.knowledge_entries for delete using (
  (tenant_id in (select current_tenant_ids()))
  and ((created_by = (select auth.uid())) or current_role_in(tenant_id) in ('owner','admin','sales_manager'))
);
drop policy if exists playbooks_delete on public.sales_playbooks;
create policy playbooks_delete on public.sales_playbooks for delete using (
  (tenant_id in (select current_tenant_ids()))
  and ((created_by = (select auth.uid())) or current_role_in(tenant_id) in ('owner','admin','sales_manager'))
);
drop policy if exists content_delete on public.content_ideas;
create policy content_delete on public.content_ideas for delete using (
  (tenant_id in (select current_tenant_ids()))
  and ((created_by = (select auth.uid())) or current_role_in(tenant_id) in ('owner','admin','sales_manager'))
);

-- (e) accounts の担当(owner_user_id)変更もDBレベルで管理ロール限定に(0086はopportunities/meetingsのみだった)。
drop trigger if exists trg_accounts_owner_reassign on public.accounts;
create trigger trg_accounts_owner_reassign
  before update of owner_user_id on public.accounts
  for each row execute function public.enforce_owner_reassign();
