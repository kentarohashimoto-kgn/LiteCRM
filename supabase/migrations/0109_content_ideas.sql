-- B8: マーケ記事パイプライン(ネタ→タイトル案→ドラフト→公開)の管理。
-- v1は手動運用の受け皿。将来、営業ニーズ(B7)＋Web検索から夜間バッチで候補を自動生成しここに積む。
create table if not exists public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  theme text,                    -- テーマ/切り口
  title text not null,           -- 記事タイトル案
  angle text,                    -- 誰に何を(狙い)
  target_keyword text,           -- SEOキーワード
  source text not null default 'manual' check (source in ('manual','sales_need','web_trend')),
  status text not null default 'idea' check (status in ('idea','selected','drafting','published')),
  body_md text,                  -- 記事ドラフト(任意)
  note text,
  scheduled_date date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_tenant_status on public.content_ideas(tenant_id, status, created_at desc);

alter table public.content_ideas enable row level security;

drop policy if exists content_select on public.content_ideas;
drop policy if exists content_insert on public.content_ideas;
drop policy if exists content_update on public.content_ideas;
drop policy if exists content_delete on public.content_ideas;

create policy content_select on public.content_ideas for select
  using (tenant_id in (select current_tenant_ids()));
create policy content_insert on public.content_ideas for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy content_update on public.content_ideas for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy content_delete on public.content_ideas for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

drop trigger if exists trg_content_updated_at on public.content_ideas;
create trigger trg_content_updated_at before update on public.content_ideas
  for each row execute function public.set_updated_at();
