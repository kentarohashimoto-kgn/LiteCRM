-- =====================================================================
-- タスク機能の刷新（Asana型: プロジェクト / ポートフォリオ / ゴール）
--
--   目的: 既存の「次アクション」タスクを、より汎用的な業務タスク管理へ拡張する。
--         既存の tasks テーブルはそのまま活かし（商談/顧客への紐付けは維持）、
--         プロジェクト・セクション（ボード列）・並び順を追加する。
--
--   モデル:
--     task_portfolios ── task_projects ── task_sections ── tasks
--                              │
--                              └─ goals（ゴール。プロジェクト/ポートフォリオ横断で設定可）
--
--   ビュー: リスト / ボード（セクション=列）/ カレンダー（期日）
--   区分  : マイタスク（assigned_to = 自分）/ チーム全体（テナント全件, RLS準拠）
-- =====================================================================

-- ---- ポートフォリオ（複数プロジェクトの束ね。進捗ロールアップの単位） ----
create table if not exists public.task_portfolios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  color text not null default 'teal',               -- UIカラーキー
  owner_user_id uuid references auth.users(id),
  status text not null default 'active',             -- active / archived
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_task_portfolios_tenant on public.task_portfolios(tenant_id);

-- ---- プロジェクト（タスクの上位。Asanaのプロジェクトに相当） ----
create table if not exists public.task_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  portfolio_id uuid references task_portfolios(id) on delete set null,
  name text not null,
  description text,
  color text not null default 'teal',                -- UIカラーキー
  icon text,                                          -- lucideアイコン名（任意）
  owner_user_id uuid references auth.users(id),
  status text not null default 'active',             -- active / archived
  start_date date,
  due_date date,
  default_view text not null default 'board',        -- list / board / calendar
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_task_projects_tenant on public.task_projects(tenant_id);
create index if not exists idx_task_projects_portfolio on public.task_projects(portfolio_id);

-- ---- セクション（プロジェクト内の区分。ボードの列・リストの見出し） ----
create table if not exists public.task_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references task_projects(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_task_sections_project on public.task_sections(project_id);

-- ---- ゴール（目標。数値目標＋進捗。親ゴール/ポートフォリオへ紐付け可） ----
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  parent_goal_id uuid references goals(id) on delete set null,
  portfolio_id uuid references task_portfolios(id) on delete set null,
  project_id uuid references task_projects(id) on delete set null,
  name text not null,
  description text,
  owner_user_id uuid references auth.users(id),
  metric_kind text not null default 'number',        -- number / percent / currency
  target_value numeric,
  current_value numeric not null default 0,
  unit text,
  status text not null default 'on_track',           -- on_track / at_risk / off_track / achieved / no_status
  period_start date,
  period_end date,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_goals_tenant on public.goals(tenant_id);
create index if not exists idx_goals_parent on public.goals(parent_goal_id);

-- ---- 既存 tasks の拡張（プロジェクト/セクション/並び順/開始日） ----
-- Asana型では期日なしタスクを許容する（列挙/集計側はnull安全に扱う）。
alter table public.tasks alter column due_date drop not null;
alter table public.tasks add column if not exists project_id uuid references task_projects(id) on delete set null;
alter table public.tasks add column if not exists section_id uuid references task_sections(id) on delete set null;
alter table public.tasks add column if not exists sort_order integer not null default 0;
alter table public.tasks add column if not exists start_date date;
create index if not exists idx_tasks_project on public.tasks(tenant_id, project_id);
create index if not exists idx_tasks_section on public.tasks(section_id);

-- ---------------------------------------------------------------------
-- RLS: テナント境界＋編集ロールで統一（既存テーブルの方針に準拠）
-- ---------------------------------------------------------------------
alter table public.task_portfolios enable row level security;
alter table public.task_projects enable row level security;
alter table public.task_sections enable row level security;
alter table public.goals enable row level security;

do $$
declare t text;
begin
  foreach t in array array['task_portfolios','task_projects','goals'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format('drop policy if exists %1$s_write on public.%1$s;', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select using (tenant_id in (select current_tenant_ids()));',
      t);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));',
      t);
  end loop;
end $$;

-- セクションは所属プロジェクトのテナントに従属
drop policy if exists task_sections_select on public.task_sections;
drop policy if exists task_sections_write on public.task_sections;
create policy task_sections_select on public.task_sections for select
  using (tenant_id in (select current_tenant_ids()));
create policy task_sections_write on public.task_sections for all
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- updated_at 自動更新トリガ ----
do $$
declare t text;
begin
  foreach t in array array['task_portfolios','task_projects','task_sections','goals'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function set_updated_at();', t);
  end loop;
end $$;
