-- =====================================================================
-- タスク機能拡張:
--   1) 自由ラベル: tasks.labels（text[]）を追加。ボードのグルーピング軸に使う。
--   2) プロジェクト参照権限: task_project_members を追加し、
--      プロジェクトは「割当メンバー＋管理者(＋作成者/オーナー)」のみ参照可能に。
--      メンバー割当は管理者(owner/admin)のみ実行可能。
-- =====================================================================

-- ---- 1) 自由ラベル ----
alter table public.tasks add column if not exists labels text[] not null default '{}';
create index if not exists idx_tasks_labels on public.tasks using gin (labels);

-- ---- 2) プロジェクトメンバー（参照権限の割当） ----
create table if not exists public.task_project_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references task_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists idx_task_project_members_project on public.task_project_members(project_id);
create index if not exists idx_task_project_members_user on public.task_project_members(tenant_id, user_id);

alter table public.task_project_members enable row level security;

drop policy if exists task_project_members_select on public.task_project_members;
drop policy if exists task_project_members_write on public.task_project_members;
-- 参照: 同一テナントなら可（自分の割当行を評価できるようにする）
create policy task_project_members_select on public.task_project_members for select
  using (tenant_id in (select current_tenant_ids()));
-- 追加/削除: 管理者(owner/admin)のみ
create policy task_project_members_write on public.task_project_members for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- ---- プロジェクトの参照ポリシーを「メンバー＋管理者(＋作成者/オーナー)」に置換 ----
drop policy if exists task_projects_select on public.task_projects;
create policy task_projects_select on public.task_projects for select
  using (
    tenant_id in (select current_tenant_ids())
    and (
      current_role_in(tenant_id) in ('owner','admin')
      or owner_user_id = auth.uid()
      or created_by = auth.uid()
      or exists (
        select 1 from public.task_project_members m
        where m.project_id = task_projects.id and m.user_id = auth.uid()
      )
    )
  );
