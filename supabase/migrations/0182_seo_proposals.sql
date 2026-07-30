-- =====================================================================
-- 0182: 改善提案（WO-34 / F-302）
--   検出した機会(seo_insights)を「承認できる提案」に変える。
--   期待値（クリック→リード→商談→売上）はアプリが確定させ、
--   AIは hypothesis / plan_md（なぜ効くか・何をするか）だけを書く。
--   AIに優先度を主観で付けさせると日によって順序が揺れ、PDCAが続かないため。
--   ロールバック: drop table seo_proposals;
-- =====================================================================
create table if not exists public.seo_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  insight_id uuid references public.seo_insights(id) on delete set null,
  cluster_id uuid references public.seo_clusters(id) on delete set null,
  title text not null,
  action_type text not null,               -- title_meta|rewrite|internal_link|merge_pages|new_article|cta_form|technical
  lever text,                              -- position|ctr|engagement|cvr|lead_quality
  intent_layer smallint,                   -- 1..3。第1層ほど売上に近い
  target_query text not null default '',
  target_page text not null default '',
  -- 根拠と期待値（すべてアプリが確定。AIは引用のみ）
  evidence_json jsonb not null default '{}'::jsonb,
  expected_json jsonb not null default '{}'::jsonb,   -- {clicks, inquiries, leads, opportunities, revenue}
  ice_impact numeric, ice_confidence numeric, ice_effort numeric,
  strategy_weight numeric not null default 1,
  ice_score numeric not null default 0,
  -- AIが書く欄（未生成でも提案として成立する）
  hypothesis text,
  plan_md text,
  ai_generated_at timestamptz,
  -- 承認フロー
  status text not null default 'pending_review',  -- pending_review|approved|rejected|snoozed|expired
  reject_reason text,                      -- not_now|not_relevant|already_done|wrong_data|other
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  proposed_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同じ対象・同じ施策タイプを同日に重複生成しない
create unique index if not exists uq_seo_proposals_daily
  on public.seo_proposals(site_id, proposed_date, action_type, target_query, target_page);
create index if not exists idx_seo_proposals_review
  on public.seo_proposals(site_id, status, ice_score desc);
-- クールダウン判定で「同じ対象の直近の提案」を引くための索引
create index if not exists idx_seo_proposals_target
  on public.seo_proposals(site_id, action_type, target_query, target_page, proposed_date desc);

drop trigger if exists trg_seo_proposals_updated on public.seo_proposals;
create trigger trg_seo_proposals_updated before update on public.seo_proposals
  for each row execute function public.set_updated_at();

alter table public.seo_proposals enable row level security;
drop policy if exists seo_proposals_sel on public.seo_proposals;
drop policy if exists seo_proposals_ins on public.seo_proposals;
drop policy if exists seo_proposals_upd on public.seo_proposals;
drop policy if exists seo_proposals_del on public.seo_proposals;
create policy seo_proposals_sel on public.seo_proposals for select
  using (tenant_id in (select current_tenant_ids()));
create policy seo_proposals_ins on public.seo_proposals for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_proposals_upd on public.seo_proposals for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy seo_proposals_del on public.seo_proposals for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

comment on table public.seo_proposals is '改善提案。期待値はアプリが確定し、AIは仮説と打ち手の文章のみ書く';
comment on column public.seo_proposals.strategy_weight is '戦略係数。短期施策偏重の近視眼を補正するためICEに掛ける';

-- 夜間AIジョブの登録（既定OFF。出力品質を確認してから開始する）
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'seo_proposal', 'SEO提案のAI肉付け（夜間）',
   '機械検出した提案に、なぜ効くか(仮説)と具体的な打ち手をAIが書き足す。1晩10件まで。',
   false, '提案の自動生成は稼働中。AIの文章追記は出力品質を確認してから開始する')
on conflict (tenant_id, job_kind) do nothing;
