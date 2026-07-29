-- =====================================================================
-- 0180: SEOグロースエンジン 計測基盤（WO-30 / F-301）
--   設計: docs/SEO_GROWTH_ENGINE_DESIGN_2026-07.md
--   戦略: docs/SEO_STRATEGY_2026-07.md
--
--   1) seo_properties … GSC/GA4 の接続単位（＝ドメイン）。1プロパティに複数サイトがぶら下がる。
--   2) seo_sites      … 計測・戦略の単位。同一ドメインでもサブディレクトリで分ける。
--        例) catorce.jp本体(B2B/法人AI研修)  path_prefix='/'  exclude_prefixes={'/career/'}
--            キャリプラ(個人向け)            path_prefix='/career/'
--            aicafe.jp(将来)                 別プロパティ + path_prefix='/'
--        ※ /career/ は検索意図もKPIも本体と別物のため、必ず分けて計測する。
--   3) seo_daily_metrics / seo_page_daily / seo_query_daily … 日次実測（GSC+GA4）
--   4) seo_page_weekly / seo_query_weekly … 週次ロールアップ（保持ポリシー用・画面はこちらを読む）
--   5) seo_pages / seo_page_issues … クロールによるページ現況と機械的欠陥
--
--   書き込みは cron（service role）。閲覧はテナントメンバー、設定変更は can_edit_role。
--   ロールバック: drop table seo_page_issues, seo_pages, seo_query_weekly, seo_page_weekly,
--                 seo_query_daily, seo_page_daily, seo_daily_metrics, seo_sites, seo_properties;
-- =====================================================================

-- ---- 1) 接続プロパティ（GSC/GA4） ----
create table if not exists public.seo_properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,                       -- 'catorce.jp'
  domain text not null,                     -- 'catorce.jp'（ホスト名。www有無は正規化して保持）
  gsc_property text,                        -- 'sc-domain:catorce.jp' or 'https://catorce.jp/'
  ga4_property_id text,                     -- GA4 プロパティID（数字）
  -- 接続診断の結果（/app/seo/settings の「接続診断」が書き込む）
  gsc_status text not null default 'unknown',   -- 'unknown'|'ok'|'forbidden'|'not_found'|'error'
  ga4_status text not null default 'unknown',
  gsc_checked_at timestamptz,
  ga4_checked_at timestamptz,
  diagnostics jsonb not null default '{}'::jsonb,  -- 診断の生結果（利用可能プロパティ一覧など）
  status text not null default 'active',    -- 'active'|'paused'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, domain)
);

-- ---- 2) 計測・戦略の単位 ----
create table if not exists public.seo_sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  property_id uuid not null references public.seo_properties(id) on delete cascade,
  name text not null,                       -- 'カトルセHP（法人）'
  base_url text not null,                   -- 'https://catorce.jp/'
  path_prefix text not null default '/',    -- このサイトに属するURLの接頭辞
  exclude_prefixes text[] not null default '{}',  -- 除外する接頭辞（本体から /career/ を外す）
  audience text not null default 'b2b',     -- 'b2b'|'b2c'  … KPIの解釈が変わる
  sitemap_url text,
  inquiry_media text,                       -- leads.inquiry_media との突合キー（'カトルセHP'）
  marketing_channel_id uuid references public.marketing_channels(id) on delete set null,
  crawl_enabled boolean not null default true,
  crawl_limit int not null default 200,
  is_primary boolean not null default false,
  last_ingested_date date,                  -- 取込カーソル（60秒制限での再開用）
  status text not null default 'active',    -- 'active'|'planned'|'paused'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, path_prefix)
);
create index if not exists idx_seo_sites_tenant on public.seo_sites(tenant_id, status);

-- ---- 3) 日次実測 ----
-- サイト全体（KPIツリーの各段を1行に統合）
create table if not exists public.seo_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  date date not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,                              -- clicks / impressions
  position numeric,                         -- 表示回数を重みにした加重平均
  sessions bigint not null default 0,
  organic_sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  avg_engagement_sec numeric,
  inquiries int not null default 0,         -- CRM: 当日の新規リード（当該メディア）
  leads_valid int not null default 0,       -- 対象外/スパムを除いた有効リード
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, date)
);
create index if not exists idx_seo_daily_site_date on public.seo_daily_metrics(site_id, date desc);

-- ページ別日次（Top300/日）
create table if not exists public.seo_page_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  date date not null,
  page_path text not null,                  -- 正規化済みパス（クエリ・フラグメント除去）
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  position numeric,
  sessions bigint not null default 0,
  engagement_rate numeric,
  unique (site_id, date, page_path)
);
create index if not exists idx_seo_page_daily_site_date on public.seo_page_daily(site_id, date desc);

-- クエリ別日次（Top500/日）
create table if not exists public.seo_query_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  date date not null,
  query text not null,
  page_path text not null default '',       -- '' = ページ内訳なしの集計行
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  position numeric,
  unique (site_id, date, query, page_path)
);
create index if not exists idx_seo_query_daily_site_date on public.seo_query_daily(site_id, date desc);
create index if not exists idx_seo_query_daily_query on public.seo_query_daily(site_id, query);

-- ---- 4) 週次ロールアップ（日次はパージされる。画面・分析はこちらを主に読む） ----
create table if not exists public.seo_page_weekly (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  week_start date not null,                 -- 月曜起点（JST）
  page_path text not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  position numeric,
  sessions bigint not null default 0,
  unique (site_id, week_start, page_path)
);
create index if not exists idx_seo_page_weekly_site on public.seo_page_weekly(site_id, week_start desc);

create table if not exists public.seo_query_weekly (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  week_start date not null,
  query text not null,
  page_path text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  position numeric,
  unique (site_id, week_start, query, page_path)
);
create index if not exists idx_seo_query_weekly_site on public.seo_query_weekly(site_id, week_start desc);
create index if not exists idx_seo_query_weekly_query on public.seo_query_weekly(site_id, query);

-- ---- 5) ページ現況（クロール結果） ----
create table if not exists public.seo_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  url_path text not null,
  title text,
  meta_description text,
  h1 text,
  word_count int,
  status_code int,
  canonical text,
  noindex boolean not null default false,
  internal_inlinks int not null default 0,
  internal_outlinks int not null default 0,
  published_at date,
  last_modified_at date,
  content_idea_id uuid references public.content_ideas(id) on delete set null,
  lcp_ms int,
  inp_ms int,
  cls numeric,
  psi_checked_at timestamptz,
  first_seen_at date not null default current_date,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, url_path)
);
create index if not exists idx_seo_pages_site on public.seo_pages(site_id);

create table if not exists public.seo_page_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  page_id uuid not null references public.seo_pages(id) on delete cascade,
  kind text not null,                       -- 'title_missing'|'title_too_long'|'meta_missing'|'h1_multiple'
                                            -- |'thin_content'|'noindex_unexpected'|'orphan_page'
                                            -- |'duplicate_title'|'slow_lcp'|'broken_link'
  severity text not null default 'medium',  -- 'high'|'medium'|'low'
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open',      -- 'open'|'fixed'|'ignored'
  first_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (page_id, kind)
);
create index if not exists idx_seo_page_issues_open on public.seo_page_issues(site_id, status, severity);

-- ---- updated_at トリガ ----
drop trigger if exists trg_seo_properties_updated on public.seo_properties;
create trigger trg_seo_properties_updated before update on public.seo_properties
  for each row execute function public.set_updated_at();
drop trigger if exists trg_seo_sites_updated on public.seo_sites;
create trigger trg_seo_sites_updated before update on public.seo_sites
  for each row execute function public.set_updated_at();
drop trigger if exists trg_seo_daily_updated on public.seo_daily_metrics;
create trigger trg_seo_daily_updated before update on public.seo_daily_metrics
  for each row execute function public.set_updated_at();
drop trigger if exists trg_seo_pages_updated on public.seo_pages;
create trigger trg_seo_pages_updated before update on public.seo_pages
  for each row execute function public.set_updated_at();

-- ---- RLS ----
-- 閲覧: テナントメンバー全員（集客の全体像。個人情報を含まない）
-- 変更: can_edit_role。取込は service role が行うためポリシー対象外。
do $$
declare t text;
begin
  foreach t in array array[
    'seo_properties','seo_sites','seo_daily_metrics','seo_page_daily','seo_query_daily',
    'seo_page_weekly','seo_query_weekly','seo_pages','seo_page_issues'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format(
      'create policy %I on public.%I for select using (tenant_id in (select current_tenant_ids()))',
      t||'_sel', t);
    execute format(
      'create policy %I on public.%I for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))',
      t||'_ins', t);
    execute format(
      'create policy %I on public.%I for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))',
      t||'_upd', t);
    execute format(
      'create policy %I on public.%I for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))',
      t||'_del', t);
  end loop;
end $$;

-- ---- 初期データ（カトルセ / 実査 2026-07-29 のヒアリング結果） ----
-- gsc_property / ga4_property_id は「接続診断」で判明した値を画面から設定する（ここでは未設定）。
insert into public.seo_properties (tenant_id, name, domain)
values ('00000000-0000-0000-0000-000000000001', 'catorce.jp', 'catorce.jp')
on conflict (tenant_id, domain) do nothing;

insert into public.seo_sites (tenant_id, property_id, name, base_url, path_prefix, exclude_prefixes, audience, inquiry_media, is_primary, sitemap_url, notes)
select
  p.tenant_id, p.id, v.name, v.base_url, v.path_prefix, v.exclude_prefixes, v.audience,
  v.inquiry_media, v.is_primary, v.sitemap_url, v.notes
from public.seo_properties p
cross join (values
  ('カトルセHP（法人）', 'https://catorce.jp/', '/', array['/career/'], 'b2b',
   'カトルセHP', true, 'https://catorce.jp/sitemap.xml',
   '法人向け（AI研修・AI顧問・AI開発・営業AX）。売上目標の主対象。'),
  ('キャリプラ（個人）', 'https://catorce.jp/career/', '/career/', array[]::text[], 'b2c',
   'キャリプラ', false, null,
   'フリーランスエンジニア個人向け。検索意図・KPIが本体と異なるため分離計測する。')
) as v(name, base_url, path_prefix, exclude_prefixes, audience, inquiry_media, is_primary, sitemap_url, notes)
where p.tenant_id = '00000000-0000-0000-0000-000000000001' and p.domain = 'catorce.jp'
on conflict (property_id, path_prefix) do nothing;

-- 将来追加（status='planned' なので取込対象外。接続情報が揃ったら画面から有効化）
insert into public.seo_properties (tenant_id, name, domain, status)
values ('00000000-0000-0000-0000-000000000001', 'aicafe.jp', 'aicafe.jp', 'paused')
on conflict (tenant_id, domain) do nothing;

insert into public.seo_sites (tenant_id, property_id, name, base_url, path_prefix, audience, inquiry_media, status, notes)
select p.tenant_id, p.id, 'Aicafe', 'https://aicafe.jp/', '/', 'b2b', 'Aicafe', 'planned',
       '将来追加。GSC/GA4のプロパティを接続診断で確認してから有効化する。'
from public.seo_properties p
where p.tenant_id = '00000000-0000-0000-0000-000000000001' and p.domain = 'aicafe.jp'
on conflict (property_id, path_prefix) do nothing;

-- ---- バッチジョブ登録（既存の「AIバッチ運用」画面から開始/停止できる） ----
-- 接続診断が通るまでは停止のまま。接続が確認できたら画面から開始する。
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'seo_ingest', 'SEO計測データ取込（毎日04:00）',
   'Search Console / GA4 / CRM実績を取り込み、サイト別の日次指標を確定する。AIは使わない決定的処理。',
   false, 'サービスアカウントの接続診断が通ってから開始する')
on conflict (tenant_id, job_kind) do nothing;

comment on table public.seo_properties is 'GSC/GA4の接続単位（ドメイン）。1プロパティに複数のseo_sitesがぶら下がる';
comment on table public.seo_sites is 'SEOの計測・戦略単位。同一ドメインでもサブディレクトリ(path_prefix)で分割する';
comment on column public.seo_sites.exclude_prefixes is 'このサイトから除外するパス接頭辞。本体サイトから /career/ を外すのに使う';
comment on column public.seo_sites.audience is 'b2b|b2c。KPIの解釈（受注単価・CVRの基準）が変わる';
