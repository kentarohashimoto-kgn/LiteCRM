-- B7: ノウハウ・事例ナレッジベース。成功/失敗ノウハウ・成約/失注理由・ささる事例(自社/他社)を蓄積し検索する。
-- v1は手動登録＋部分一致検索(日本語対応のためILIKE/JS側フィルタ)。将来AI自動抽出(議事録から)とpgvector検索を追加。
create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null default 'knowhow' check (kind in ('knowhow','win_reason','loss_reason','case_study')),
  title text not null,
  body text not null default '',
  is_own_company boolean not null default true,  -- 事例の自社/他社
  account_id uuid references accounts(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  industry text,
  competitor text,
  tags text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual','ai_extracted')),
  status text not null default 'approved' check (status in ('draft','approved')),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_knowledge_tenant_kind on public.knowledge_entries(tenant_id, kind, created_at desc);
create index if not exists idx_knowledge_tags on public.knowledge_entries using gin(tags);

alter table public.knowledge_entries enable row level security;

drop policy if exists knowledge_select on public.knowledge_entries;
drop policy if exists knowledge_insert on public.knowledge_entries;
drop policy if exists knowledge_update on public.knowledge_entries;
drop policy if exists knowledge_delete on public.knowledge_entries;

create policy knowledge_select on public.knowledge_entries for select
  using (tenant_id in (select current_tenant_ids()));
create policy knowledge_insert on public.knowledge_entries for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy knowledge_update on public.knowledge_entries for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy knowledge_delete on public.knowledge_entries for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

drop trigger if exists trg_knowledge_updated_at on public.knowledge_entries;
create trigger trg_knowledge_updated_at before update on public.knowledge_entries
  for each row execute function public.set_updated_at();
