-- =====================================================================
-- 案件管理（デリバリー原価・粗利管理）
--   コンサル型/顧問/伴走/カスタム開発の案件を、提案時の粗利設計から
--   受注後の月次・週次予実まで管理する。閲覧・操作は管理職のみ。
--
--   モデル: opportunity 1件 ── project_plans 1件
--             ├ project_revenue_months   月別の販売(売上)計画
--             ├ project_assignments       アサイン(外注 talents / 社員 auth.users)
--             │   └ project_cost_months   アサイン×月の工数・稼働率・原価
--             ├ project_weekly_reports    週次の実績・報告
--             └ project_assignment_changes アサイン入替の履歴
-- =====================================================================

-- 管理職判定(代表/管理者/Sales Ops/経理/デリバリーPM)。案件管理の閲覧・操作単位。
create or replace function public.is_project_mgr(p_tenant uuid)
returns boolean language sql stable as $$
  select coalesce(public.current_role_in(p_tenant), '') in
    ('owner', 'admin', 'sales_manager', 'finance', 'delivery');
$$;

-- ---- 案件フラグ ----
alter table public.opportunities
  add column if not exists is_project_managed boolean not null default false;

-- ---- タレント: 単価・稼働(人事/経理で管理) ----
alter table public.talents add column if not exists cost_rate numeric;      -- 原価単価(円/人月)
alter table public.talents add column if not exists bill_rate numeric;      -- 請求単価(円/人月)
alter table public.talents add column if not exists available_from date;    -- 稼働可能日
alter table public.talents add column if not exists skill_tags text[];      -- スキルタグ

-- ---- 実行計画ヘッダ(1案件1件) ----
create table if not exists public.project_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  account_id uuid references accounts(id),
  start_month date,                                 -- YYYY-MM-01
  end_month date,
  min_gross_rate numeric not null default 0.25,     -- 最低粗利率(値引き下限計算)
  hq_involvement text not null default 'none',      -- none/low/middle/high
  plan_risk text not null default 'low',            -- low/middle/high
  status text not null default 'planning',          -- planning/baselined/in_progress/closed
  baseline_locked_at timestamptz,                   -- 受注でベースライン確定した時刻
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_project_plans_opp on public.project_plans(opportunity_id);
create index if not exists idx_project_plans_tenant on public.project_plans(tenant_id);

-- ---- 月別の販売(売上)計画 ----
create table if not exists public.project_revenue_months (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null references project_plans(id) on delete cascade,
  month date not null,                              -- YYYY-MM-01
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_prev_plan_month on public.project_revenue_months(plan_id, month);

-- ---- アサイン(外注 or 社員) ----
create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null references project_plans(id) on delete cascade,
  kind text not null default 'external',            -- external(外注) / internal(社員)
  talent_id uuid references talents(id) on delete set null,
  member_user_id uuid references auth.users(id),
  label text not null,                              -- 表示名(選択時のスナップショット)
  role text,                                        -- 役割(コンサル/PM/エンジニア等)
  cost_rate numeric not null default 0,             -- 原価単価(円/人月)
  bill_rate numeric,                                -- 請求単価(任意)
  start_month date,
  end_month date,
  status text not null default 'active',            -- active/replaced/removed
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pa_plan on public.project_assignments(plan_id);
create index if not exists idx_pa_tenant on public.project_assignments(tenant_id);

-- ---- アサイン×月(工数・稼働率・原価) ----
create table if not exists public.project_cost_months (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null references project_plans(id) on delete cascade,
  assignment_id uuid not null references project_assignments(id) on delete cascade,
  month date not null,                              -- YYYY-MM-01
  man_month numeric not null default 0,             -- 人月
  ratio numeric not null default 1,                 -- 稼働率 0..1
  cost_amount numeric not null default 0,           -- = cost_rate × man_month × ratio(書込時に算出)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_pcm_assign_month on public.project_cost_months(assignment_id, month);
create index if not exists idx_pcm_plan on public.project_cost_months(plan_id);

-- ---- 週次実績(外注の週次報告を含む) ----
create table if not exists public.project_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null references project_plans(id) on delete cascade,
  assignment_id uuid references project_assignments(id) on delete set null,
  week_start date not null,                         -- 週の月曜(YYYY-MM-DD)
  planned_mm numeric,                               -- 予定工数(人月)
  actual_mm numeric,                                -- 実績工数(人月)
  planned_cost numeric,                             -- 予定原価
  actual_cost numeric,                              -- 実績原価
  progress_pct numeric,                             -- 進捗率 0..100
  status text not null default 'on_track',          -- on_track/watch/over/blocked
  reporter text,                                    -- 報告者(外注名など)
  blockers text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pwr_plan on public.project_weekly_reports(plan_id);
create index if not exists idx_pwr_week on public.project_weekly_reports(plan_id, week_start);

-- ---- アサイン入替の履歴 ----
create table if not exists public.project_assignment_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null references project_plans(id) on delete cascade,
  from_assignment_id uuid references project_assignments(id) on delete set null,
  to_assignment_id uuid references project_assignments(id) on delete set null,
  from_label text,
  to_label text,
  effective_month date,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_pac_plan on public.project_assignment_changes(plan_id);

-- ---- updated_at トリガー ----
do $$
declare t text;
begin
  foreach t in array array[
    'project_plans','project_revenue_months','project_assignments',
    'project_cost_months','project_weekly_reports'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
      for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ---- RLS: 案件管理は管理職のみ(閲覧・操作とも is_project_mgr) ----
do $$
declare t text;
begin
  foreach t in array array[
    'project_plans','project_revenue_months','project_assignments',
    'project_cost_months','project_weekly_reports','project_assignment_changes'
  ] loop
    execute format('alter table public.%1$s enable row level security;', t);
    execute format('drop policy if exists %1$s_all on public.%1$s;', t);
    execute format('create policy %1$s_all on public.%1$s for all
      using (tenant_id in (select current_tenant_ids()) and public.is_project_mgr(tenant_id))
      with check (tenant_id in (select current_tenant_ids()) and public.is_project_mgr(tenant_id));', t);
  end loop;
end $$;
