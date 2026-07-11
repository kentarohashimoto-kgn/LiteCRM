-- 展示会ドリルダウン: リード(未商談含む)にも社内コメントスレッドを持たせる。
-- 展示会別の「未商談の重要リスト」で、アプローチ状況・進捗を追記できるようにする。
-- opportunity_comments と同じ設計に合わせる。
create table if not exists public.lead_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_comments_lead on public.lead_comments(lead_id, created_at desc);

alter table public.lead_comments enable row level security;

drop policy if exists lead_comments_select on public.lead_comments;
drop policy if exists lead_comments_insert on public.lead_comments;
drop policy if exists lead_comments_delete on public.lead_comments;

create policy lead_comments_select on public.lead_comments for select
  using (tenant_id in (select current_tenant_ids()));
create policy lead_comments_insert on public.lead_comments for insert
  with check (tenant_id in (select current_tenant_ids()) and author_user_id = auth.uid());
create policy lead_comments_delete on public.lead_comments for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (author_user_id = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );
