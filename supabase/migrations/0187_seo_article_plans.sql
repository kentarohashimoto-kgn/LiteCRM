-- =====================================================================
-- 0187: 記事プラン（F-307b / キーワード設計の本格化）
--   背景: docs/SEO_STRATEGY_V2_KEYWORD_DRIVEN_2026-07.md §5
--
--   KW 1語 = 1記事 ではない。「生成AI研修 費用」「AI研修 費用」
--   「生成AI研修 料金 相場」は1つの料金ページで取る。
--   逆に1語のために1記事作ると、薄い記事が量産されてサイト全体が沈む。
--
--   そこで「記事プラン」を設計の単位にする:
--     1記事 = メインKW 1つ + サブKW 数語 + 構成案
--   これにより
--     ・提案が記事単位で1件にまとまる（同じ記事の提案が分散しない）
--     ・「この記事で6語狙って3語取れている」が見える
--     ・記事の期待値をサブKW合計で評価できる（1語だけ見て諦めない）
--
--   併せて難易度(difficulty)を導入する。難易度を見ずに検索数だけで選ぶと、
--   競合が強い語ばかり狙って半年成果ゼロになる。
--
--   ロールバック:
--     alter table seo_keywords drop column article_plan_id, drop column difficulty;
--     drop table seo_article_plans;
-- =====================================================================

create table if not exists public.seo_article_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  cluster_id uuid references public.seo_clusters(id) on delete set null,
  -- 記事の企画
  title text not null,                      -- 記事タイトル案
  main_keyword text not null,               -- この記事で1位を狙う語
  intent_layer smallint,                    -- 1..3
  angle text,                               -- 誰に何を（狙い）
  outline_md text,                          -- 見出し構成案
  -- 優先順位付けの материал
  difficulty smallint,                      -- 1(易)〜5(難)。競合の強さ
  priority int not null default 3,          -- 1(最優先)〜5
  page_role text,                           -- pillar|cluster|pricing|case|service
  -- 進行
  status text not null default 'planned',   -- planned|writing|review|published|dropped
  content_idea_id uuid references public.content_ideas(id) on delete set null,
  published_page_id uuid references public.seo_pages(id) on delete set null,
  published_url text,                       -- 公開後のURL（クロール前でも手入力できる）
  published_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, main_keyword)
);
create index if not exists idx_seo_article_plans_site
  on public.seo_article_plans(site_id, status, priority, difficulty);

-- どの記事でその語を取るか
alter table public.seo_keywords add column if not exists article_plan_id uuid
  references public.seo_article_plans(id) on delete set null;
-- 勝ちやすさ。1(易)〜5(難)。新規で狙うなら難易度の低い語から積む
alter table public.seo_keywords add column if not exists difficulty smallint;
create index if not exists idx_seo_keywords_plan on public.seo_keywords(article_plan_id);

comment on table public.seo_article_plans is '記事プラン。1記事=メインKW1つ+サブKW数語。SEO設計の単位';
comment on column public.seo_article_plans.difficulty is '1(易)〜5(難)。難易度を見ずに検索数だけで選ぶと半年成果ゼロになる';
comment on column public.seo_keywords.difficulty is '同上。新規サイトは難易度1〜3から積み上げる';

drop trigger if exists trg_seo_article_plans_updated on public.seo_article_plans;
create trigger trg_seo_article_plans_updated before update on public.seo_article_plans
  for each row execute function public.set_updated_at();

alter table public.seo_article_plans enable row level security;
drop policy if exists seo_article_plans_sel on public.seo_article_plans;
drop policy if exists seo_article_plans_ins on public.seo_article_plans;
drop policy if exists seo_article_plans_upd on public.seo_article_plans;
drop policy if exists seo_article_plans_del on public.seo_article_plans;
create policy seo_article_plans_sel on public.seo_article_plans for select
  using (tenant_id in (select current_tenant_ids()));
create policy seo_article_plans_ins on public.seo_article_plans for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_article_plans_upd on public.seo_article_plans for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_article_plans_del on public.seo_article_plans for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- RPC: 記事プラン別の進捗 ----
-- 「この記事で何語狙って、何語取れているか」。1語だけ見て諦めないための集計。
create or replace function public.seo_article_plan_progress(p_site uuid)
returns table (
  plan_id uuid,
  title text,
  main_keyword text,
  intent_layer smallint,
  cluster_name text,
  difficulty smallint,
  priority int,
  page_role text,
  status text,
  published_url text,
  keyword_count int,
  total_volume bigint,
  ranked_top10 int,
  ranked_any int,
  impressions bigint,
  clicks bigint
)
language sql stable security invoker set search_path = public as $$
  with r as (select * from seo_keyword_rankings(p_site, 2))
  select
    p.id, p.title, p.main_keyword, p.intent_layer, c.name,
    p.difficulty, p.priority, p.page_role, p.status, p.published_url,
    count(k.id)::int,
    coalesce(sum(k.search_volume), 0)::bigint,
    count(r.keyword_id) filter (where r.gap_status = 'top10')::int,
    count(r.keyword_id) filter (where r.current_position is not null)::int,
    coalesce(sum(r.impressions), 0)::bigint,
    coalesce(sum(r.clicks), 0)::bigint
  from seo_article_plans p
  left join seo_clusters c on c.id = p.cluster_id
  left join seo_keywords k on k.article_plan_id = p.id and k.status = 'active'
  left join r on r.keyword_id = k.id
  where p.site_id = p_site and p.status <> 'dropped'
  group by p.id, p.title, p.main_keyword, p.intent_layer, c.name,
           p.difficulty, p.priority, p.page_role, p.status, p.published_url
  order by p.intent_layer nulls last, p.priority, p.difficulty nulls last,
           coalesce(sum(k.search_volume), 0) desc;
$$;

comment on function public.seo_article_plan_progress is '記事プラン別の狙う語数・取れている語数・流入。記事単位で成果を見る';
