-- =====================================================================
-- 0209: 改善提案を「記事プラン単位」にする（重複提案の根治）
--   背景: ユーザーレビュー（2026-08-08）。改善提案の画面に
--         「狙う語『生成AI研修』を取る（新規記事の作成）」が4件並んでいた。
--
--   原因は2つ:
--     1) 提案の単位が KW 1語だった。記事プラン（1記事=メインKW1つ+サブKW数語）
--        を 0187/0189 で導入したのに、提案生成 (lib/seo/run-proposals.ts) は
--        まだ KW を1語ずつ提案していた。「生成AI研修」プランは27語ぶら下がって
--        いるので、承認するたびに別々の記事チケットが立つ状態だった。
--     2) 未承認のまま3日経つと同じ対象の提案が再生成され、古い pending が
--        残り続けた。承認待ち83件のうち大半が同じ対象の重複だった。
--
--   本マイグレーションでやること:
--     A) seo_keyword_rankings に記事プランの識別子と属性を追加する
--        （提案生成側でプラン単位に束ねるために必要）
--     B) seo_proposals に article_plan_id を追加する
--     C) 既存の重複した承認待ちを1件に畳む（最新を残し superseded にする）
--     D) 「同じ対象の承認待ちは1件まで」を部分ユニーク索引で保証する
--
--   ロールバック:
--     drop index uq_seo_proposals_open;
--     alter table seo_proposals drop column article_plan_id;
--     （RPC は 0189 の定義に戻す）
-- =====================================================================

-- ---- A) 記事プランの識別子を順位表RPCに載せる ----
-- 0189 で plan_title / planned_url までは返していたが、提案をプラン単位で
-- 束ねるには「どのプランか(id)」「メインKWは何か」「既に公開済みか」が要る。
-- 依存する2つのRPCも同じ定義で作り直す（SQL関数の本体は依存追跡されないので明示的に落とす）
drop function if exists public.seo_keyword_gap(uuid);
drop function if exists public.seo_article_plan_progress(uuid);
drop function if exists public.seo_keyword_rankings(uuid, int);

create function public.seo_keyword_rankings(p_site uuid, p_weeks int default 8)
returns table (
  keyword_id uuid, query text, intent_layer smallint, cluster_name text,
  search_volume int, target_position_6m int, target_position_12m int, priority int,
  plan_title text, planned_url text, is_existing_page boolean,
  current_position numeric, prev_position numeric, delta numeric,
  impressions bigint, clicks bigint, ranking_page text,
  page_mismatch boolean, gap_status text,
  -- ここから 0209 で追加（末尾に足すので既存の呼び出しは壊れない）
  article_plan_id uuid, plan_main_keyword text, plan_status text,
  plan_published_url text, plan_page_role text, difficulty smallint
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with weeks as (
    select distinct week_start from seo_query_weekly
    where site_id = p_site order by week_start desc limit 2
  ),
  cur_week as (select max(week_start) w from weeks),
  prev_week as (select min(week_start) w from weeks where (select count(*) from weeks) > 1),
  cur as (
    select q.query,
           round(sum(q.position * q.impressions) / nullif(sum(q.impressions), 0), 1) as position,
           sum(q.impressions)::bigint as impressions,
           sum(q.clicks)::bigint as clicks,
           (array_agg(q.page_path order by q.impressions desc))[1] as ranking_page
    from seo_query_weekly q, cur_week
    where q.site_id = p_site and q.week_start = cur_week.w
    group by q.query
  ),
  prev as (
    select q.query,
           round(sum(q.position * q.impressions) / nullif(sum(q.impressions), 0), 1) as position
    from seo_query_weekly q, prev_week
    where q.site_id = p_site and q.week_start = prev_week.w
    group by q.query
  )
  select
    k.id, k.query, k.intent_layer, c.name,
    k.search_volume, k.target_position_6m, k.target_position_12m, k.priority,
    ap.title, ap.planned_url, coalesce(ap.is_existing_page, false),
    cur.position, prev.position,
    case when cur.position is not null and prev.position is not null
      then round(prev.position - cur.position, 1) end,
    coalesce(cur.impressions, 0), coalesce(cur.clicks, 0), cur.ranking_page,
    (ap.planned_url is not null and cur.ranking_page is not null and ap.planned_url <> cur.ranking_page),
    case
      -- 既存ページで狙うのに表示0 = 圏外（ページはあるが的を外している）
      when cur.position is null and coalesce(ap.is_existing_page, false) then 'out'
      when cur.position is null then 'no_page'
      when cur.position <= 10 then 'top10'
      when cur.position <= 20 then 'striking'
      else 'far'
    end,
    ap.id, ap.main_keyword, ap.status, ap.published_url, ap.page_role,
    coalesce(k.difficulty, ap.difficulty)
  from seo_keywords k
  left join seo_clusters c on c.id = k.cluster_id
  left join seo_article_plans ap on ap.id = k.article_plan_id
  left join cur on cur.query = k.query
  left join prev on prev.query = k.query
  where k.site_id = p_site and k.status = 'active' and k.is_target
  order by k.intent_layer nulls last, k.priority, k.search_volume desc nulls last;
$$;

comment on function public.seo_keyword_rankings is
  '狙ったKW×週次順位×対策ページ×二段階目標。1検索意図=1ページの設計を可視化する。記事プランの識別子も返す（提案をプラン単位に束ねるため）';

-- 依存関数を 0189 と同じ定義で戻す
create function public.seo_keyword_gap(p_site uuid)
returns table (
  intent_layer smallint, gap_status text, keywords int,
  total_volume bigint, total_impressions bigint, total_clicks bigint
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select r.intent_layer, r.gap_status, count(*)::int,
         coalesce(sum(r.search_volume), 0)::bigint,
         coalesce(sum(r.impressions), 0)::bigint,
         coalesce(sum(r.clicks), 0)::bigint
  from seo_keyword_rankings(p_site, 2) r
  group by r.intent_layer, r.gap_status
  order by r.intent_layer nulls last,
    case r.gap_status when 'no_page' then 1 when 'out' then 2 when 'far' then 3
                      when 'striking' then 4 else 5 end;
$$;

create function public.seo_article_plan_progress(p_site uuid)
returns table (
  plan_id uuid, title text, main_keyword text, intent_layer smallint,
  cluster_name text, difficulty smallint, priority int, page_role text,
  page_type text, planned_url text, is_existing_page boolean,
  status text, published_url text,
  keyword_count int, total_volume bigint, ranked_top10 int, ranked_any int,
  impressions bigint, clicks bigint
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with r as (select * from seo_keyword_rankings(p_site, 2))
  select
    p.id, p.title, p.main_keyword, p.intent_layer, c.name,
    p.difficulty, p.priority, p.page_role, p.page_type, p.planned_url,
    coalesce(p.is_existing_page, false), p.status, p.published_url,
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
           p.difficulty, p.priority, p.page_role, p.page_type, p.planned_url,
           p.is_existing_page, p.status, p.published_url
  order by p.intent_layer nulls last, p.priority, p.difficulty nulls last,
           coalesce(sum(k.search_volume), 0) desc;
$$;

-- ---- B) 提案に記事プランを紐付ける ----
alter table public.seo_proposals
  add column if not exists article_plan_id uuid references public.seo_article_plans(id) on delete set null;
create index if not exists idx_seo_proposals_plan on public.seo_proposals(article_plan_id);
comment on column public.seo_proposals.article_plan_id is
  '提案の対象記事プラン。1提案=1記事。承認すると「この記事で狙う語」全部を含む指示書になる';
comment on column public.seo_proposals.status is
  'pending_review|approved|rejected|snoozed|expired|superseded。superseded=同じ対象の新しい提案に置き換えられた';

-- ---- C) 既存の重複した承認待ちを畳む ----
-- 同じ対象(施策タイプ×KW×ページ)の承認待ちが複数あるとき、最新の1件だけ残す。
-- 消さずに superseded にするのは、いつ何が提案されたかの履歴を壊さないため。
with ranked as (
  select id,
         row_number() over (
           partition by site_id, action_type, target_query, coalesce(target_page, '')
           order by proposed_date desc, created_at desc
         ) as rn
  from public.seo_proposals
  where status = 'pending_review'
)
update public.seo_proposals p
   set status = 'superseded'
  from ranked
 where ranked.id = p.id and ranked.rn > 1;

-- ---- D) 「同じ対象の承認待ちは常に1件」をDBで保証する ----
-- コード側でも重複を作らないようにするが、片方だけだと運用中に必ず崩れる。
create unique index if not exists uq_seo_proposals_open
  on public.seo_proposals(site_id, action_type, target_query, coalesce(target_page, ''))
  where status = 'pending_review';
