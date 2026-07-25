-- =====================================================================
-- P4 AIヘルプ (RAG基盤) — docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md §5
--   documents(リンク台帳)の本文を抽出・チャンク化し、埋め込みと全文索引を持たせる。
--   検索は「ベクトル + 日本語キーワード」のハイブリッド(RRF)。
--   学習対象は ①601資料庫の資料 ②CRMにリンクされた資料。
--   除外は index_status='excluded'(契約書類/請求/人事 等)。
--   埋め込み: OpenAI text-embedding-3-small (dimensions=1024)
-- =====================================================================

create extension if not exists vector;
create extension if not exists pgroonga;

create table if not exists public.document_chunks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  document_id  uuid not null references documents(id) on delete cascade,
  chunk_no     int not null,
  content      text not null,
  embedding    vector(1024),
  meta         jsonb not null default '{}'::jsonb,   -- {category, title, page}
  created_at   timestamptz not null default now(),
  unique (document_id, chunk_no)
);
create index if not exists idx_dc_tenant on public.document_chunks(tenant_id);
-- ベクトル近傍探索(コサイン)
create index if not exists idx_dc_embedding on public.document_chunks
  using hnsw (embedding vector_cosine_ops);
-- 日本語キーワード検索(形態素不要のN-gram)
create index if not exists idx_dc_content_pgroonga on public.document_chunks
  using pgroonga (content);

alter table public.document_chunks enable row level security;
-- 参照はテナント内メンバー。書込はバッチ(service role)のみ。
drop policy if exists dc_select on public.document_chunks;
create policy dc_select on public.document_chunks for select
  using (tenant_id in (select current_tenant_ids()));

-- ---------------------------------------------------------------------
-- ハイブリッド検索RPC: ベクトル順位とキーワード順位を RRF(Reciprocal Rank Fusion) で統合。
-- SECURITY DEFINER だが current_tenant_ids() でテナントを必ず絞る(横断参照を防ぐ)。
-- p_categories が渡された場合はその種別に限定(タグ絞り込み)。
-- ---------------------------------------------------------------------
create or replace function public.search_document_chunks(
  p_embedding vector(1024),
  p_query text,
  p_limit int default 12,
  p_categories text[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  title text,
  category text,
  web_url text,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select c.id, c.document_id, c.content, d.title, d.category, d.web_url
    from document_chunks c
    join documents d on d.id = c.document_id
    where c.tenant_id in (select current_tenant_ids())
      and d.index_status <> 'excluded'
      and (p_categories is null or d.category = any(p_categories))
  ),
  vec as (
    select s.id, row_number() over (order by c.embedding <=> p_embedding) as rnk
    from scoped s join document_chunks c on c.id = s.id
    where p_embedding is not null and c.embedding is not null
    order by c.embedding <=> p_embedding
    limit 50
  ),
  kw as (
    select s.id, row_number() over (order by pgroonga_score(c.tableoid, c.ctid) desc) as rnk
    from scoped s join document_chunks c on c.id = s.id
    where p_query is not null and p_query <> '' and c.content &@~ p_query
    limit 50
  )
  select s.id, s.document_id, s.content, s.title, s.category, s.web_url,
         coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as score
  from scoped s
  left join vec v on v.id = s.id
  left join kw  k on k.id = s.id
  where v.id is not null or k.id is not null
  order by score desc
  limit p_limit;
$$;

revoke all on function public.search_document_chunks(vector, text, int, text[]) from public, anon;
grant execute on function public.search_document_chunks(vector, text, int, text[]) to authenticated;
