-- =====================================================================
-- F-203 タスクコメント（社内スレッド・@メンション）
--   案件コメント(0066 opportunity_comments)と同型。指示・引継ぎがSlackに散逸しないように。
--   メンション(uuid[])はアプリ側でアプリ内ベル＋Slack通知に使用。
-- =====================================================================
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_task_comments_task on public.task_comments(task_id, created_at desc);

alter table public.task_comments enable row level security;

-- 参照は同一テナント（タスク本体の参照可否はアプリ層＋タスクRLSで担保）
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select
  using (tenant_id in (select current_tenant_ids()));
-- 投稿は本人のみ
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert
  with check (tenant_id in (select current_tenant_ids()) and author_user_id = auth.uid());
-- 削除は本人 or 管理者
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (author_user_id = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );
