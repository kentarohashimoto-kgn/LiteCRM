-- =====================================================================
-- 0181: SEO所見（WO-33 / F-301）
--   機械検出した機会・劣化を1件1行で保持する。
--   finding_md は後続(WO-34)で夜間AIが「なぜそうなったか」を書き込む欄。
--   数値はすべてアプリ側で確定済みで、AIは metric_json を引用するだけにする
--   （数値がブレるとPDCAの継続性が壊れるため）。
--   ロールバック: drop table seo_insights;
-- =====================================================================
create table if not exists public.seo_insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  run_date date not null,
  kind text not null,                       -- ctr_opportunity|zero_click|striking_distance
                                            -- |rank_decline|click_drop|cannibalization|intent_mix
  scope text not null,                      -- 'site'|'page'|'query'
  -- NOT NULL + 既定'' にしているのは、upsert の一意キーに使うため
  -- （NULL入りの列は一意制約で同一と判定されず、同じ検出が毎回増える）
  query text not null default '',
  page_path text not null default '',
  title text not null,                      -- 機械生成の見出し
  severity text not null default 'medium',  -- 'high'|'medium'|'low'
  metric_json jsonb not null default '{}'::jsonb,
  opportunity_score numeric not null default 0,
  action_type text,                         -- 想定される施策タイプ（WO-34の提案で使う）
  finding_md text,                          -- 後続でAIが書く所見
  ai_generated_at timestamptz,
  status text not null default 'open',      -- 'open'|'proposed'|'resolved'|'ignored'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同じ日に同じ検出を重複させない（cronと手動実行の両方から呼ばれるため）
create unique index if not exists uq_seo_insights_daily
  on public.seo_insights(site_id, run_date, kind, query, page_path);
create index if not exists idx_seo_insights_open
  on public.seo_insights(site_id, status, opportunity_score desc);

drop trigger if exists trg_seo_insights_updated on public.seo_insights;
create trigger trg_seo_insights_updated before update on public.seo_insights
  for each row execute function public.set_updated_at();

alter table public.seo_insights enable row level security;
drop policy if exists seo_insights_sel on public.seo_insights;
drop policy if exists seo_insights_ins on public.seo_insights;
drop policy if exists seo_insights_upd on public.seo_insights;
drop policy if exists seo_insights_del on public.seo_insights;
create policy seo_insights_sel on public.seo_insights for select
  using (tenant_id in (select current_tenant_ids()));
create policy seo_insights_ins on public.seo_insights for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_insights_upd on public.seo_insights for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_insights_del on public.seo_insights for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

comment on table public.seo_insights is 'SEOの機会・劣化の機械検出結果。数値はアプリが確定し、AIは解釈のみ書く';
