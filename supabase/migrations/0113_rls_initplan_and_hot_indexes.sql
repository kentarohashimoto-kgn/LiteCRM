-- パフォーマンス監査(2026-07-12)対応②:
-- (1) 高トラフィックテーブルのRLSポリシーで auth.uid() が行毎に再評価されていたのを
--     (select auth.uid()) に書き換え、クエリ毎1回の評価(initplan)にする。定義は既存と同一意味。
-- (2) RLSのEXISTS句が使う外部キーの不足インデックスを追加。
-- (3) content_ideas に has_draft 生成列を追加(一覧でbody_md全文を転送しないため)。

-- ===== (1) RLS initplan 修正 =====
-- accounts
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select using (
  (tenant_id in (select current_tenant_ids())) and (deleted_at is null)
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid()))
       or (exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = (select auth.uid()))))
);
drop policy if exists accounts_upd on public.accounts;
create policy accounts_upd on public.accounts for update using (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid()))
       or (exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = (select auth.uid()))))
) with check (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
);

-- activities
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select using (
  (tenant_id in (select current_tenant_ids()))
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid()))
       or (exists (select 1 from opportunities o where o.id = activities.opportunity_id and o.owner_user_id = (select auth.uid()))))
);
drop policy if exists activities_upd on public.activities;
create policy activities_upd on public.activities for update using (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid())))
) with check (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
);
drop policy if exists activities_del on public.activities;
create policy activities_del on public.activities for delete using (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid())))
);

-- billing_schedules
drop policy if exists billing_select on public.billing_schedules;
create policy billing_select on public.billing_schedules for select using (
  (tenant_id in (select current_tenant_ids()))
  and (can_view_all(tenant_id)
       or (exists (select 1 from opportunities o where o.id = billing_schedules.opportunity_id and o.owner_user_id = (select auth.uid()))))
);

-- contacts
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select using (
  (tenant_id in (select current_tenant_ids()))
  and (can_view_all(tenant_id)
       or (exists (select 1 from opportunities o where o.account_id = contacts.account_id and o.owner_user_id = (select auth.uid()))))
);
drop policy if exists contacts_upd on public.contacts;
create policy contacts_upd on public.contacts for update using (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
  and (can_view_all(tenant_id)
       or (exists (select 1 from opportunities o where o.account_id = contacts.account_id and o.owner_user_id = (select auth.uid()))))
) with check (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
);

-- leads
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (
  (tenant_id in (select current_tenant_ids()))
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid())))
  and (deleted_at is null)
);
drop policy if exists leads_upd on public.leads;
create policy leads_upd on public.leads for update using (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid())))
) with check (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
);

-- meetings
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  (tenant_id in (select current_tenant_ids()))
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid()))
       or (exists (select 1 from opportunities o where o.id = meetings.opportunity_id and o.owner_user_id = (select auth.uid()))))
);

-- notifications
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (user_id = (select auth.uid()));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete using (user_id = (select auth.uid()));

-- opportunities
drop policy if exists opps_select on public.opportunities;
create policy opps_select on public.opportunities for select using (
  (tenant_id in (select current_tenant_ids()))
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid())))
  and (deleted_at is null)
);
drop policy if exists opps_upd on public.opportunities;
create policy opps_upd on public.opportunities for update using (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
  and (can_view_all(tenant_id) or (owner_user_id = (select auth.uid())))
) with check (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
);

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  (id = (select auth.uid()))
  or (exists (select 1 from memberships m1 join memberships m2 on m1.tenant_id = m2.tenant_id
              where m1.user_id = (select auth.uid()) and m2.user_id = profiles.id))
);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select using (
  (tenant_id in (select current_tenant_ids()))
  and (can_view_all(tenant_id) or (assigned_to = (select auth.uid())) or (created_by = (select auth.uid())))
);
drop policy if exists tasks_upd on public.tasks;
create policy tasks_upd on public.tasks for update using (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
  and (can_view_all(tenant_id) or (assigned_to = (select auth.uid())) or (created_by = (select auth.uid())))
) with check (
  (tenant_id in (select current_tenant_ids())) and can_edit_role(tenant_id)
);

-- weekly_rep_reports
drop policy if exists rep_report_insert on public.weekly_rep_reports;
create policy rep_report_insert on public.weekly_rep_reports for insert with check (
  (tenant_id in (select current_tenant_ids())) and ((owner_user_id = (select auth.uid())) or can_edit_role(tenant_id))
);
drop policy if exists rep_report_update on public.weekly_rep_reports;
create policy rep_report_update on public.weekly_rep_reports for update using (
  (tenant_id in (select current_tenant_ids())) and ((owner_user_id = (select auth.uid())) or can_edit_role(tenant_id))
);

-- ===== (2) 不足インデックス(RLSのEXISTS句・頻出フィルタで使用) =====
create index if not exists idx_opps_account_owner on public.opportunities(account_id, owner_user_id);
create index if not exists idx_meetings_owner on public.meetings(owner_user_id);
create index if not exists idx_meetings_account on public.meetings(account_id);

-- ===== (3) 記事一覧の軽量化: 本文全文を転送せず有無だけ取れる生成列 =====
alter table public.content_ideas
  add column if not exists has_draft boolean generated always as (coalesce(length(btrim(body_md)),0) > 0) stored;
