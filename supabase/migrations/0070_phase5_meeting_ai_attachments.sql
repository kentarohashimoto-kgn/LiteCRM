-- 第5弾: D-4 議事録AI要約の保存先 + C-3 ファイル添付

-- ---- D-4: 商談(meetings)にAI要約列を追加 ----
alter table public.meetings
  add column if not exists ai_summary text,
  add column if not exists ai_summary_at timestamptz;

comment on column public.meetings.ai_summary is 'minutes_detail からAI生成した要約(D-4)';

-- ---- C-3: ファイル添付のメタデータ ----
-- 実体は Supabase Storage の非公開バケット 'attachments'。
-- アップロード/ダウンロード(署名URL)/削除はサーバー側(service role)で行い、
-- メタデータの参照可否はこのテーブルのRLSで制御する。
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  target_type text not null check (target_type in ('opportunity','account')),
  target_id uuid not null,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint not null default 0,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_attachments_target on public.attachments(tenant_id, target_type, target_id, created_at desc);

alter table public.attachments enable row level security;

create policy attachments_select on public.attachments for select
  using (tenant_id in (select current_tenant_ids()));
create policy attachments_insert on public.attachments for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy attachments_delete on public.attachments for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (uploaded_by = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );

-- 非公開バケット(存在しなければ作成)
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
