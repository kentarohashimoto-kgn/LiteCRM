-- =====================================================================
-- F-202 サブタスク・繰り返しタスク
--   - tasks.parent_task_id: サブタスク（1階層のみ。トリガーで強制）。
--   - tasks.recurrence: 繰り返しルール(jsonb)。完了時に次回タスクを生成し、
--     ルールは次回タスクへ引き継ぐ（Asana方式）。
--   - tasks.recurrence_source_id: 繰り返し系列の起点タスク（連鎖の追跡用）。
-- =====================================================================

alter table public.tasks add column if not exists parent_task_id uuid references tasks(id) on delete cascade;
alter table public.tasks add column if not exists recurrence jsonb;
alter table public.tasks add column if not exists recurrence_source_id uuid references tasks(id) on delete set null;

create index if not exists idx_tasks_parent on public.tasks(parent_task_id);

-- ---- 1階層制約: サブタスクの下にサブタスクを作らせない ----
create or replace function public.enforce_single_level_subtask()
returns trigger
language plpgsql
as $$
begin
  if new.parent_task_id is not null then
    if new.parent_task_id = new.id then
      raise exception '自分自身を親タスクにはできません';
    end if;
    if exists (select 1 from tasks p where p.id = new.parent_task_id and p.parent_task_id is not null) then
      raise exception 'サブタスクの下にサブタスクは作成できません';
    end if;
    if exists (select 1 from tasks c where c.parent_task_id = new.id) then
      raise exception 'サブタスクを持つタスクをサブタスク化することはできません';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_subtask_depth on public.tasks;
create trigger trg_tasks_subtask_depth
  before insert or update of parent_task_id on public.tasks
  for each row execute function enforce_single_level_subtask();
