-- =====================================================================
-- 0183: 集客アトリビューション（WO-31 / F-305）
--   「検索 → 着地ページ → 問合せ → リード → 商談 → 受注金額」をつなぐ。
--   設計: docs/SEO_GROWTH_ENGINE_DESIGN_2026-07.md F-305
--
--   1) leads に着地ページ・UTM・流入種別を追加（/api/lead-intake が埋める）
--   2) ファネル集計RPC（SEO集客画面が読む唯一の入口）
--   3) ページ別の売上貢献RPC（「どの記事が稼いだか」）
--   4) アトリビューション健全性RPC
--      実査(2026-07-29)時点で opportunities の lead_id 充足率は2%しかなく、
--      このままではSEO由来売上が常に¥0になる。まず「今どれだけ繋がっているか」を
--      常時可視化し、劣化に気づける状態にする。
--
--   ロールバック:
--     drop function seo_attribution_health, seo_page_revenue, seo_funnel_summary;
--     alter table leads drop column landing_page, ... ;
-- =====================================================================

-- ---- 1) leads: 流入コンテキスト ----
alter table public.leads add column if not exists landing_page text;      -- 最初に着地したページ（正規化済みパス）
alter table public.leads add column if not exists entry_referrer text;    -- 参照元URL
alter table public.leads add column if not exists utm_source text;
alter table public.leads add column if not exists utm_medium text;
alter table public.leads add column if not exists utm_campaign text;
alter table public.leads add column if not exists utm_term text;
alter table public.leads add column if not exists utm_content text;
alter table public.leads add column if not exists gclid text;
alter table public.leads add column if not exists first_visit_at timestamptz;
alter table public.leads add column if not exists acquisition_type text;  -- organic|paid|direct|referral|email|social|unknown

comment on column public.leads.landing_page is '最初に着地したページ（クエリ除去済みパス）。SEO成果の帰属先';
comment on column public.leads.acquisition_type is '流入種別。organic のみをSEOの成果として数える（広告を混ぜない）';

create index if not exists idx_leads_landing_page on public.leads(landing_page) where landing_page is not null;
create index if not exists idx_leads_acquisition on public.leads(tenant_id, acquisition_type, created_at desc)
  where acquisition_type is not null;

-- ---- 2) ファネル集計 ----
-- 検索側(seo_daily_metrics) と 商談側(leads→opportunities) を1行に統合して返す。
-- 画面はこの関数だけを読む（画面側で集計ロジックを持たない）。
create or replace function public.seo_funnel_summary(
  p_site uuid,
  p_from date,
  p_to date
)
returns table (
  impressions bigint,
  clicks bigint,
  ctr numeric,
  avg_position numeric,
  sessions bigint,
  inquiries int,
  leads_valid int,
  opportunities int,
  won int,
  revenue numeric,
  cvr numeric,
  lead_to_opp numeric,
  win_rate numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with site as (
    select s.id, s.tenant_id, s.inquiry_media
    from seo_sites s
    where s.id = p_site
  ),
  search as (
    select
      coalesce(sum(m.impressions), 0)::bigint as impressions,
      coalesce(sum(m.clicks), 0)::bigint      as clicks,
      coalesce(sum(m.sessions), 0)::bigint    as sessions,
      -- 平均順位は表示回数を重みにした加重平均（単純平均は誤り）
      case when sum(m.impressions) > 0
        then round(sum(m.position * m.impressions) / sum(m.impressions), 2)
      end as avg_position
    from seo_daily_metrics m, site
    where m.site_id = site.id and m.date between p_from and p_to
  ),
  lead_rows as (
    select l.id, l.funnel_stage
    from leads l, site
    where l.tenant_id = site.tenant_id
      and l.inquiry_media is not null
      and l.inquiry_media = site.inquiry_media
      and l.created_at >= (p_from::timestamp at time zone 'Asia/Tokyo')
      and l.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Tokyo')
  ),
  opp_rows as (
    select o.id, o.stage, o.amount
    from opportunities o
    where o.lead_id in (select id from lead_rows)
  )
  select
    search.impressions,
    search.clicks,
    case when search.impressions > 0
      then round(search.clicks::numeric / search.impressions, 4) end as ctr,
    search.avg_position,
    search.sessions,
    (select count(*) from lead_rows)::int as inquiries,
    (select count(*) from lead_rows where funnel_stage is distinct from 'disqualified')::int as leads_valid,
    (select count(*) from opp_rows)::int as opportunities,
    (select count(*) from opp_rows where stage = 'won')::int as won,
    (select coalesce(sum(amount), 0) from opp_rows where stage = 'won') as revenue,
    case when search.sessions > 0
      then round((select count(*) from lead_rows)::numeric / search.sessions, 4) end as cvr,
    case when (select count(*) from lead_rows where funnel_stage is distinct from 'disqualified') > 0
      then round((select count(*) from opp_rows)::numeric
                 / (select count(*) from lead_rows where funnel_stage is distinct from 'disqualified'), 4) end as lead_to_opp,
    case when (select count(*) from opp_rows where stage in ('won','lost')) > 0
      then round((select count(*) from opp_rows where stage = 'won')::numeric
                 / (select count(*) from opp_rows where stage in ('won','lost')), 4) end as win_rate
  from search;
$$;

-- ---- 3) ページ別の売上貢献（「どの記事が稼いだか」） ----
create or replace function public.seo_page_revenue(
  p_site uuid,
  p_from date,
  p_to date
)
returns table (
  page_path text,
  clicks bigint,
  inquiries int,
  leads_valid int,
  opportunities int,
  won int,
  revenue numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with site as (
    select s.id, s.tenant_id, s.inquiry_media from seo_sites s where s.id = p_site
  ),
  clicks_by_page as (
    select d.page_path, sum(d.clicks)::bigint as clicks
    from seo_page_daily d, site
    where d.site_id = site.id and d.date between p_from and p_to
    group by d.page_path
  ),
  leads_by_page as (
    select
      l.landing_page as page_path,
      count(*)::int as inquiries,
      count(*) filter (where l.funnel_stage is distinct from 'disqualified')::int as leads_valid,
      array_agg(l.id) as lead_ids
    from leads l, site
    where l.tenant_id = site.tenant_id
      and l.landing_page is not null
      and l.inquiry_media = site.inquiry_media
      and l.created_at >= (p_from::timestamp at time zone 'Asia/Tokyo')
      and l.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Tokyo')
    group by l.landing_page
  ),
  opps_by_page as (
    select
      lp.page_path,
      count(o.id)::int as opportunities,
      count(o.id) filter (where o.stage = 'won')::int as won,
      coalesce(sum(o.amount) filter (where o.stage = 'won'), 0) as revenue
    from leads_by_page lp
    left join opportunities o on o.lead_id = any(lp.lead_ids)
    group by lp.page_path
  )
  select
    coalesce(c.page_path, l.page_path) as page_path,
    coalesce(c.clicks, 0)::bigint      as clicks,
    coalesce(l.inquiries, 0)           as inquiries,
    coalesce(l.leads_valid, 0)         as leads_valid,
    coalesce(o.opportunities, 0)       as opportunities,
    coalesce(o.won, 0)                 as won,
    coalesce(o.revenue, 0)             as revenue
  from clicks_by_page c
  full outer join leads_by_page l on l.page_path = c.page_path
  left join opps_by_page o on o.page_path = coalesce(c.page_path, l.page_path)
  order by 7 desc, 2 desc;
$$;

-- ---- 4) アトリビューション健全性 ----
-- 「集客の成果を売上として証明できる状態か」を1行で返す。
-- link_rate が低いまま運用すると、SEOがどれだけ成功しても売上が¥0に見える。
create or replace function public.seo_attribution_health(p_tenant uuid, p_days int default 90)
returns table (
  opportunities_total int,
  opportunities_linked int,
  link_rate numeric,
  inquiry_leads_total int,
  inquiry_leads_with_landing int,
  landing_rate numeric,
  unlinked_recent int
)
language sql
stable
security invoker
set search_path = public
as $$
  with since as (select (now() - make_interval(days => p_days)) as ts),
  opps as (
    select o.id, o.lead_id
    from opportunities o, since
    where o.tenant_id = p_tenant and o.created_at >= since.ts
  ),
  inq as (
    select l.id, l.landing_page
    from leads l, since
    where l.tenant_id = p_tenant and l.created_at >= since.ts
      and l.inquiry_media is not null
  )
  select
    (select count(*) from opps)::int,
    (select count(*) from opps where lead_id is not null)::int,
    case when (select count(*) from opps) > 0
      then round((select count(*) from opps where lead_id is not null)::numeric
                 / (select count(*) from opps), 4) end,
    (select count(*) from inq)::int,
    (select count(*) from inq where landing_page is not null)::int,
    case when (select count(*) from inq) > 0
      then round((select count(*) from inq where landing_page is not null)::numeric
                 / (select count(*) from inq), 4) end,
    (select count(*) from opps where lead_id is null)::int;
$$;

comment on function public.seo_funnel_summary is 'SEO集客のファネル実測（検索→問合せ→商談→受注金額）を1行で返す';
comment on function public.seo_page_revenue is 'ページ別の売上貢献。どの記事が受注を生んだかを示す';
comment on function public.seo_attribution_health is 'リード→商談の紐付け率。低いとSEO成果を売上として証明できない';
