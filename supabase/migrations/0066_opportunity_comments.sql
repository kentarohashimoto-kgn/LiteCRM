-- C-2 案件コメント(社内スレッド): 本部→営業の指示・引継ぎがSlackに散逸しないように
-- 案件にコメントスレッドを持たせる。メンション(uuid[])はアプリ側でSlack通知に使用。
create table if not exists public.opportunity_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_opp_comments_opp on public.opportunity_comments(opportunity_id, created_at desc);

alter table public.opportunity_comments enable row level security;

create policy opp_comments_select on public.opportunity_comments for select
  using (tenant_id in (select current_tenant_ids()));
create policy opp_comments_insert on public.opportunity_comments for insert
  with check (tenant_id in (select current_tenant_ids()) and author_user_id = auth.uid());
-- 削除は本人 or 管理者
create policy opp_comments_delete on public.opportunity_comments for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (author_user_id = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );
