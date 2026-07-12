-- 障害対応(2026-07-12): leads等の大テーブルでRLSが can_view_all(tenant_id) を行毎に実行し
-- (行毎にmembershipsをSECURITY DEFINERで参照)、リード系画面の全件取得が~4.6s×並列でCPU飽和
-- →全画面タイムアウト連鎖。権限判定を「クエリ毎1回(initplan)」に完全化する。
-- 意味は既存と同一: view_all_tenant_ids ⊆ current_tenant_ids(ロール限定版)。
-- 効果実測: leads全件(8,271行) 約4.6s → 6.7ms。owner/external_salesのパリティ一致(越権0)。

create or replace function public.view_all_tenant_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select tenant_id from memberships
  where user_id = auth.uid() and status = 'active'
    and role in ('owner','admin','sales_manager','viewer');
$$;
revoke execute on function public.view_all_tenant_ids() from public, anon;
grant execute on function public.view_all_tenant_ids() to authenticated;

create or replace function public.edit_tenant_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select tenant_id from memberships
  where user_id = auth.uid() and status = 'active'
    and role in ('owner','admin','sales_manager','sales_rep','external_sales');
$$;
revoke execute on function public.edit_tenant_ids() from public, anon;
grant execute on function public.edit_tenant_ids() to authenticated;

-- (2) 高頻度テーブルのポリシーを行毎関数呼び出しゼロの形に書換(意味は同一)

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (
  (deleted_at is null) and (
    tenant_id in (select view_all_tenant_ids())
    or (tenant_id in (select current_tenant_ids()) and owner_user_id = (select auth.uid()))
  )
);
drop policy if exists leads_upd on public.leads;
create policy leads_upd on public.leads for update using (
  tenant_id in (select edit_tenant_ids())
  and (tenant_id in (select view_all_tenant_ids()) or owner_user_id = (select auth.uid()))
) with check ( tenant_id in (select edit_tenant_ids()) );

drop policy if exists opps_select on public.opportunities;
create policy opps_select on public.opportunities for select using (
  (deleted_at is null) and (
    tenant_id in (select view_all_tenant_ids())
    or (tenant_id in (select current_tenant_ids()) and owner_user_id = (select auth.uid()))
  )
);
drop policy if exists opps_upd on public.opportunities;
create policy opps_upd on public.opportunities for update using (
  tenant_id in (select edit_tenant_ids())
  and (tenant_id in (select view_all_tenant_ids()) or owner_user_id = (select auth.uid()))
) with check ( tenant_id in (select edit_tenant_ids()) );

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select using (
  (deleted_at is null) and (
    tenant_id in (select view_all_tenant_ids())
    or (tenant_id in (select current_tenant_ids()) and (
         owner_user_id = (select auth.uid())
         or exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = (select auth.uid()))
       ))
  )
);
drop policy if exists accounts_upd on public.accounts;
create policy accounts_upd on public.accounts for update using (
  tenant_id in (select edit_tenant_ids())
  and (
    tenant_id in (select view_all_tenant_ids())
    or owner_user_id = (select auth.uid())
    or exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = (select auth.uid()))
  )
) with check ( tenant_id in (select edit_tenant_ids()) );

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and exists (select 1 from opportunities o where o.account_id = contacts.account_id and o.owner_user_id = (select auth.uid())))
);
drop policy if exists contacts_upd on public.contacts;
create policy contacts_upd on public.contacts for update using (
  tenant_id in (select edit_tenant_ids())
  and (
    tenant_id in (select view_all_tenant_ids())
    or exists (select 1 from opportunities o where o.account_id = contacts.account_id and o.owner_user_id = (select auth.uid()))
  )
) with check ( tenant_id in (select edit_tenant_ids()) );

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and (
       owner_user_id = (select auth.uid())
       or exists (select 1 from opportunities o where o.id = meetings.opportunity_id and o.owner_user_id = (select auth.uid()))
     ))
);

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and (
       owner_user_id = (select auth.uid())
       or exists (select 1 from opportunities o where o.id = activities.opportunity_id and o.owner_user_id = (select auth.uid()))
     ))
);
drop policy if exists activities_upd on public.activities;
create policy activities_upd on public.activities for update using (
  tenant_id in (select edit_tenant_ids())
  and (tenant_id in (select view_all_tenant_ids()) or owner_user_id = (select auth.uid()))
) with check ( tenant_id in (select edit_tenant_ids()) );
drop policy if exists activities_del on public.activities;
create policy activities_del on public.activities for delete using (
  tenant_id in (select edit_tenant_ids())
  and (tenant_id in (select view_all_tenant_ids()) or owner_user_id = (select auth.uid()))
);

drop policy if exists billing_select on public.billing_schedules;
create policy billing_select on public.billing_schedules for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and exists (select 1 from opportunities o where o.id = billing_schedules.opportunity_id and o.owner_user_id = (select auth.uid())))
);

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and ((assigned_to = (select auth.uid())) or (created_by = (select auth.uid()))))
);
drop policy if exists tasks_upd on public.tasks;
create policy tasks_upd on public.tasks for update using (
  tenant_id in (select edit_tenant_ids())
  and (tenant_id in (select view_all_tenant_ids()) or (assigned_to = (select auth.uid())) or (created_by = (select auth.uid())))
) with check ( tenant_id in (select edit_tenant_ids()) );
