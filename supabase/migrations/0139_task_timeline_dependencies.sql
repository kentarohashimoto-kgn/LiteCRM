-- =====================================================================
-- F-201 タイムライン(ガント): タスク依存関係とマイルストーン
--   - task_dependencies: 先行→後続（v1はFS型のみ）。同一プロジェクト内に限定。
--   - tasks.is_milestone: マイルストーン（due_dateの一点イベント。◆表示）。
--   - add_task_dependency(): 循環検出つきの依存追加RPC（invoker権限=RLS準拠）。
-- =====================================================================

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  predecessor_task_id uuid not null references tasks(id) on delete cascade,
  successor_task_id uuid not null references tasks(id) on delete cascade,
  dep_type text not null default 'fs',   -- v1はfsのみ。将来: ss/ff/sf
  lag_days integer not null default 0,   -- v1はUI非公開（0固定）
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (predecessor_task_id, successor_task_id),
  check (predecessor_task_id <> successor_task_id)
);
create index if not exists idx_task_deps_pred on public.task_dependencies(predecessor_task_id);
create index if not exists idx_task_deps_succ on public.task_dependencies(successor_task_id);
create index if not exists idx_task_deps_tenant on public.task_dependencies(tenant_id);

alter table public.tasks add column if not exists is_milestone boolean not null default false;

alter table public.task_dependencies enable row level security;

drop policy if exists task_dependencies_select on public.task_dependencies;
drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies for select
  using (tenant_id in (select current_tenant_ids()));
create policy task_dependencies_write on public.task_dependencies for all
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---------------------------------------------------------------------
-- 依存追加RPC: 同一プロジェクト検証＋循環検出を1トランザクションで行う。
-- invoker権限のため tasks / task_dependencies のRLSがそのまま効く。
-- ---------------------------------------------------------------------
create or replace function public.add_task_dependency(p_predecessor uuid, p_successor uuid)
returns uuid
language plpgsql
volatile
set search_path = public
as $$
declare
  v_tenant uuid;
  v_pred_project uuid;
  v_succ_project uuid;
  v_id uuid;
begin
  if p_predecessor = p_successor then
    raise exception '同じタスク同士に依存関係は設定できません';
  end if;

  select tenant_id, project_id into v_tenant, v_pred_project from tasks where id = p_predecessor;
  select project_id into v_succ_project from tasks where id = p_successor;
  if v_tenant is null then
    raise exception 'タスクが見つかりません';
  end if;
  if v_pred_project is null or v_succ_project is distinct from v_pred_project then
    raise exception '依存関係は同一プロジェクト内のタスク同士のみ設定できます';
  end if;

  -- 循環検出: 追加予定の辺(先行→後続)を足すと循環になる＝後続から辿って先行に到達できる
  if exists (
    with recursive reach as (
      select d.successor_task_id as tid
      from task_dependencies d
      where d.predecessor_task_id = p_successor
      union
      select d.successor_task_id
      from task_dependencies d
      join reach r on d.predecessor_task_id = r.tid
    )
    select 1 from reach where tid = p_predecessor
  ) then
    raise exception '循環する依存関係は設定できません';
  end if;

  insert into task_dependencies (tenant_id, predecessor_task_id, successor_task_id, created_by)
  values (v_tenant, p_predecessor, p_successor, auth.uid())
  on conflict (predecessor_task_id, successor_task_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from task_dependencies
    where predecessor_task_id = p_predecessor and successor_task_id = p_successor;
  end if;
  return v_id;
end $$;

revoke all on function public.add_task_dependency(uuid, uuid) from public, anon;
grant execute on function public.add_task_dependency(uuid, uuid) to authenticated, service_role;
