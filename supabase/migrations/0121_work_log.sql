-- =====================================================================
-- 0121: 稼働報告（週次実績記入 → 承認 → 原価管理連動）
--   外部委託・フリーランス・社内メンバーが担当案件の日次実績
--   （稼働時間＋タスク/成果/Next Action/リスク/メモ）を記入し、
--   週次で提出 → 管理職が承認/差戻し → 承認済み実績が原価管理の
--   実績原価・月次請求の元データになる。
--   モデル: project_assignments(既存) ── work_weeks(アサイン×週の状態)
--                                      └ work_entries(日次の記入行)
-- =====================================================================

-- ---- タレントとCRMユーザーの紐付け（業務委託のログインで自分のアサインを特定） ----
alter table public.talents add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists uq_talents_user on public.talents(tenant_id, user_id) where user_id is not null;

-- ---- 権限ヘルパー（0119と同型: クエリ毎1回のinitplan評価） ----
-- 案件管理の管理職(承認者)ロールのテナント
create or replace function public.project_mgr_tenant_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select tenant_id from memberships
  where user_id = auth.uid() and status = 'active'
    and role in ('owner','admin','sales_manager','finance','delivery');
$$;
revoke execute on function public.project_mgr_tenant_ids() from public, anon;
grant execute on function public.project_mgr_tenant_ids() to authenticated;

-- 自分が記入できるアサイン（社員=member_user_id / 外部=talents.user_id）
create or replace function public.my_assignment_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select pa.id
  from project_assignments pa
  left join talents t on t.id = pa.talent_id
  where pa.status = 'active'
    and (pa.member_user_id = auth.uid() or t.user_id = auth.uid());
$$;
revoke execute on function public.my_assignment_ids() from public, anon;
grant execute on function public.my_assignment_ids() to authenticated;

-- ---- 週（アサイン×週）の提出・承認状態 ----
create table if not exists public.work_weeks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null references project_plans(id) on delete cascade,
  assignment_id uuid not null references project_assignments(id) on delete cascade,
  week_start date not null,                          -- 週の月曜
  status text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text,                                  -- 差戻し理由・承認コメント
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_work_weeks_assign_week on public.work_weeks(assignment_id, week_start);
create index if not exists idx_work_weeks_tenant_status on public.work_weeks(tenant_id, status);
create index if not exists idx_work_weeks_plan on public.work_weeks(plan_id);
create trigger trg_work_weeks_updated before update on public.work_weeks
  for each row execute function public.set_updated_at();

-- ---- 日次実績（報告スプレッドシートの1行に相当） ----
create table if not exists public.work_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null references project_plans(id) on delete cascade,
  assignment_id uuid not null references project_assignments(id) on delete cascade,
  work_date date not null,
  week_start date not null,                          -- work_dateの週の月曜（アプリで算出）
  hours numeric not null default 0,
  task_text text,                                    -- タスク（カテゴリ＋内容）
  outcome_text text,                                 -- 成果（定量＋定性）
  next_action_text text,                             -- Next Action（タスク＋目標値）
  risk_text text,                                    -- リスク・懸念
  memo text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_work_entries_assign_week on public.work_entries(assignment_id, week_start);
create index if not exists idx_work_entries_plan_date on public.work_entries(plan_id, work_date);
create index if not exists idx_work_entries_tenant_date on public.work_entries(tenant_id, work_date);
create trigger trg_work_entries_updated before update on public.work_entries
  for each row execute function public.set_updated_at();

-- ---- RLS ----
alter table public.work_weeks enable row level security;
alter table public.work_entries enable row level security;

-- 閲覧: 管理職はテナント全件 / 本人は自分の行のみ
create policy work_weeks_select on public.work_weeks for select using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and created_by = (select auth.uid()))
);
-- 作成: 本人（自分のアサインのみ） or 管理職
create policy work_weeks_insert on public.work_weeks for insert with check (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and assignment_id in (select my_assignment_ids()))
);
-- 更新: 管理職は承認/差戻し可。本人は draft/submitted への遷移のみ（承認の自作自演をRLSで防止）
create policy work_weeks_update on public.work_weeks for update using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and created_by = (select auth.uid()))
) with check (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and status in ('draft','submitted') and reviewed_by is null)
);
create policy work_weeks_delete on public.work_weeks for delete using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and created_by = (select auth.uid()) and status = 'draft')
);

-- 記入行: 提出済み・承認済みの週はRLSレベルでロック（本人は書けない）
create policy work_entries_select on public.work_entries for select using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and created_by = (select auth.uid()))
);
create policy work_entries_insert on public.work_entries for insert with check (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and assignment_id in (select my_assignment_ids())
      and not exists (select 1 from work_weeks w
        where w.assignment_id = work_entries.assignment_id
          and w.week_start = work_entries.week_start
          and w.status in ('submitted','approved')))
);
create policy work_entries_update on public.work_entries for update using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and not exists (select 1 from work_weeks w
        where w.assignment_id = work_entries.assignment_id
          and w.week_start = work_entries.week_start
          and w.status in ('submitted','approved')))
) with check (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids()) and created_by = (select auth.uid()))
);
create policy work_entries_delete on public.work_entries for delete using (
  tenant_id in (select project_mgr_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and created_by = (select auth.uid())
      and not exists (select 1 from work_weeks w
        where w.assignment_id = work_entries.assignment_id
          and w.week_start = work_entries.week_start
          and w.status in ('submitted','approved')))
);

-- ---- 記入者用コンテキストRPC ----
-- 記入ページに必要な最小情報のみ返す（原価単価・売上等の財務情報は含めない）。
-- talents/project_plans等のRLSは管理職向けのため、本人アクセスはこのRPC経由に限定する。
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
  select coalesce(jsonb_agg(jsonb_build_object(
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
  )), '[]'::jsonb) into result from a;
  return result;
end $$;
revoke execute on function public.my_work_context() from public, anon;
grant execute on function public.my_work_context() to authenticated;
