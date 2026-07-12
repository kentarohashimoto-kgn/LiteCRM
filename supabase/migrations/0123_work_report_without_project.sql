-- =====================================================================
-- 0123: 稼働報告の案件非依存化
--   「稼働報告が必須か」は担当者(タレント)ごとの設定にし、
--   「どの案件の原価に紐づけるか」は別設定(=既存の案件アサイン)に分離する。
--   営業メンバー等、案件に紐づかない稼働は talent_id キーの
--   「全般稼働」として記入・承認できる(原価管理へは反映しない)。
-- =====================================================================

-- ---- 担当者ごとの「稼働報告必須」フラグ ----
alter table public.talents add column if not exists work_report_required boolean not null default false;

-- ---- work_weeks / work_entries を talent キーでも張れるように ----
alter table public.work_weeks alter column plan_id drop not null;
alter table public.work_weeks alter column assignment_id drop not null;
alter table public.work_weeks add column if not exists talent_id uuid references talents(id) on delete cascade;
alter table public.work_entries alter column plan_id drop not null;
alter table public.work_entries alter column assignment_id drop not null;
alter table public.work_entries add column if not exists talent_id uuid references talents(id) on delete cascade;

-- どちらかのキーが必須(案件アサイン紐づき or 全般稼働)
alter table public.work_weeks drop constraint if exists chk_work_weeks_key;
alter table public.work_weeks add constraint chk_work_weeks_key check (assignment_id is not null or talent_id is not null);
alter table public.work_entries drop constraint if exists chk_work_entries_key;
alter table public.work_entries add constraint chk_work_entries_key check (assignment_id is not null or talent_id is not null);

create unique index if not exists uq_work_weeks_talent_week on public.work_weeks(talent_id, week_start) where assignment_id is null;
create index if not exists idx_work_entries_talent_week on public.work_entries(talent_id, week_start);

-- ---- 本人のタレントID解決ヘルパー ----
create or replace function public.my_talent_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select id from talents where user_id = auth.uid();
$$;
revoke execute on function public.my_talent_ids() from public, anon;
grant execute on function public.my_talent_ids() to authenticated;

-- ---- 案件管理職はタレントを閲覧できる(承認画面の氏名解決・紐づけ設定用) ----
drop policy if exists talents_select_project_mgr on public.talents;
create policy talents_select_project_mgr on public.talents for select using (
  tenant_id in (select project_mgr_tenant_ids())
);

-- ---- RLSポリシーを talent キー対応に更新(意味は0121と同一+全般稼働) ----
drop policy if exists work_weeks_insert on public.work_weeks;
create policy work_weeks_insert on public.work_weeks for insert with check (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and ((assignment_id is not null and assignment_id in (select my_assignment_ids()))
        or (assignment_id is null and talent_id in (select my_talent_ids()))))
);

drop policy if exists work_entries_insert on public.work_entries;
create policy work_entries_insert on public.work_entries for insert with check (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and ((assignment_id is not null and assignment_id in (select my_assignment_ids()))
        or (assignment_id is null and talent_id in (select my_talent_ids())))
      and not exists (select 1 from work_weeks w
        where w.week_start = work_entries.week_start
          and w.status in ('submitted','approved')
          and ((work_entries.assignment_id is not null and w.assignment_id = work_entries.assignment_id)
            or (work_entries.assignment_id is null and w.talent_id = work_entries.talent_id))))
);

drop policy if exists work_entries_update on public.work_entries;
create policy work_entries_update on public.work_entries for update using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and not exists (select 1 from work_weeks w
        where w.week_start = work_entries.week_start
          and w.status in ('submitted','approved')
          and ((work_entries.assignment_id is not null and w.assignment_id = work_entries.assignment_id)
            or (work_entries.assignment_id is null and w.talent_id = work_entries.talent_id))))
) with check (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and created_by = (select auth.uid()))
);

drop policy if exists work_entries_delete on public.work_entries;
create policy work_entries_delete on public.work_entries for delete using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and not exists (select 1 from work_weeks w
        where w.week_start = work_entries.week_start
          and w.status in ('submitted','approved')
          and ((work_entries.assignment_id is not null and w.assignment_id = work_entries.assignment_id)
            or (work_entries.assignment_id is null and w.talent_id = work_entries.talent_id))))
);

-- ---- 記入者コンテキストRPC v2: 全般稼働(talent)情報を追加 ----
create or replace function public.my_work_context()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  with a as materialized (
    select pa.id, pa.plan_id, pa.label, pa.role,
           coalesce(pp.hours_per_month, 160) as hours_per_month,
           o.name as opp_name, coalesce(acc.name, '') as account_name,
           pp.start_month, pp.end_month
    from project_assignments pa
    join project_plans pp on pp.id = pa.plan_id
    join opportunities o on o.id = pp.opportunity_id
    left join accounts acc on acc.id = pp.account_id
    left join talents t on t.id = pa.talent_id
    where pa.status = 'active'
      and pa.tenant_id in (select current_tenant_ids())
      and (pa.member_user_id = auth.uid() or t.user_id = auth.uid())
  )
  select jsonb_build_object(
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
      'assignment_id', a.id,
      'plan_id', a.plan_id,
      'label', a.label,
      'role', a.role,
      'opp_name', a.opp_name,
      'account_name', a.account_name,
      'hours_per_month', a.hours_per_month,
      'start_month', a.start_month,
      'end_month', a.end_month,
      'planned_months', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'month', to_char(cm.month, 'YYYY-MM'),
          'hours', coalesce(cm.hours, round(cm.man_month * coalesce(cm.ratio, 1) * a.hours_per_month))
        ) order by cm.month), '[]'::jsonb)
        from project_cost_months cm where cm.assignment_id = a.id
      )
    )) from a), '[]'::jsonb),
    'talent', (
      select jsonb_build_object('talent_id', t.id, 'name', t.name, 'work_report_required', t.work_report_required)
      from talents t
      where t.user_id = auth.uid() and t.tenant_id in (select current_tenant_ids())
      limit 1
    )
  ) into result;
  return result;
end $$;
revoke execute on function public.my_work_context() from public, anon;
grant execute on function public.my_work_context() to authenticated;
