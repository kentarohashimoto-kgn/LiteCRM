-- =====================================================================
-- 0184: SEO戦略ボード（WO-32 / F-306）
--   戦略: docs/SEO_STRATEGY_2026-07.md / 設計: SEO_GROWTH_ENGINE_DESIGN §10
--
--   戦略は書いた瞬間から風化する。「今どこまで進み、どこがズレたか」が
--   毎日見えないと、日次PDCAは目先の小改善だけを回す装置になる。
--   戦略ドキュメントの数値部分を、実測値で毎日置き換え続けるための器。
--
--   1) seo_strategies            … 目標売上・期間・想定レート・戦略係数
--   2) seo_clusters              … トピッククラスタ（＝商材）。products と接続
--   3) seo_strategy_milestones   … 90日ロードマップ
--   4) seo_keywords              … ターゲットKW台帳（意図層・クラスタ付き）
--   5) seo_pages にクラスタ/役割を追加
--
--   ロールバック:
--     drop table seo_strategy_milestones, seo_keywords, seo_clusters, seo_strategies;
--     alter table seo_pages drop column cluster_id, drop column page_role;
-- =====================================================================

-- ---- 1) 戦略（同時に有効なのは1サイト1本） ----
create table if not exists public.seo_strategies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  name text not null,
  period_from date not null,
  period_to date not null,
  target_monthly_revenue numeric not null,
  -- CRM実績が足りない初期のフォールバック（実績が揃えば実績を優先）
  assumed_deal_amount numeric,
  assumed_win_rate numeric,
  assumed_opp_rate numeric,
  assumed_valid_rate numeric,
  assumed_inquiry_cvr numeric,
  assumed_ctr numeric,
  -- ICEに掛ける戦略係数（短期施策偏重の近視眼を補正する。WO-34で使用）
  weight_priority_cluster numeric not null default 1.5,
  weight_layer1 numeric not null default 1.3,
  weight_current_phase numeric not null default 1.2,
  current_phase text not null default 'phase0',
  status text not null default 'active',      -- 'draft'|'active'|'archived'
  note_md text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seo_strategies_site on public.seo_strategies(site_id, status);

-- ---- 2) トピッククラスタ（＝商材） ----
create table if not exists public.seo_clusters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  name text not null,
  product_id uuid references public.products(id) on delete set null,
  pillar_page_id uuid references public.seo_pages(id) on delete set null,
  target_article_count int not null default 8,
  priority int not null default 3,            -- 1(最優先)〜5
  status text not null default 'planned',     -- 'planned'|'active'|'completed'|'out_of_scope'
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name)
);
create index if not exists idx_seo_clusters_site on public.seo_clusters(site_id, priority);

-- ---- 3) 90日ロードマップ ----
create table if not exists public.seo_strategy_milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  strategy_id uuid not null references public.seo_strategies(id) on delete cascade,
  phase text not null,                        -- 'phase0'..'phase4'
  seq int not null default 0,
  title text not null,
  due_date date,
  status text not null default 'todo',        -- 'todo'|'in_progress'|'done'|'skipped'
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seo_milestones_strategy on public.seo_strategy_milestones(strategy_id, phase, seq);

-- ---- 4) ターゲットKW台帳 ----
create table if not exists public.seo_keywords (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  site_id uuid not null references public.seo_sites(id) on delete cascade,
  query text not null,
  intent_layer smallint,                      -- 1=比較検討 / 2=課題認識 / 3=情報収集
  cluster_id uuid references public.seo_clusters(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  is_target boolean not null default true,
  target_page_id uuid references public.seo_pages(id) on delete set null,
  priority int not null default 3,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, query)
);
create index if not exists idx_seo_keywords_site on public.seo_keywords(site_id, intent_layer);
create index if not exists idx_seo_keywords_cluster on public.seo_keywords(cluster_id);

-- ---- 5) ページにクラスタ・役割 ----
alter table public.seo_pages add column if not exists cluster_id uuid references public.seo_clusters(id) on delete set null;
alter table public.seo_pages add column if not exists page_role text;  -- 'pillar'|'cluster'|'service'|'case'|'pricing'|'other'
create index if not exists idx_seo_pages_cluster on public.seo_pages(cluster_id);

comment on table public.seo_strategies is '集客戦略。目標売上から各段の必要数値を逆算する基準';
comment on table public.seo_clusters is 'トピッククラスタ（＝商材）。1クラスタ=ピラー1本+記事N本+相互内部リンク';
comment on column public.seo_keywords.intent_layer is '1=比較検討(今すぐ客) / 2=課題認識 / 3=情報収集。第1層が最も売上に近い';

-- ---- updated_at トリガ ----
do $$
declare t text;
begin
  foreach t in array array['seo_strategies','seo_clusters','seo_strategy_milestones','seo_keywords'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_updated', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'trg_'||t||'_updated', t);
  end loop;
end $$;

-- ---- RLS（閲覧はメンバー全員 / 変更は can_edit_role。戦略本体のみ owner/admin） ----
do $$
declare t text;
begin
  foreach t in array array['seo_clusters','seo_strategy_milestones','seo_keywords'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for select using (tenant_id in (select current_tenant_ids()))', t||'_sel', t);
    execute format('create policy %I on public.%I for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_ins', t);
    execute format('create policy %I on public.%I for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))', t||'_del', t);
  end loop;
end $$;

-- 戦略本体は事業目標そのもの。日常操作で変わってはいけないので owner/admin のみ変更可。
alter table public.seo_strategies enable row level security;
drop policy if exists seo_strategies_sel on public.seo_strategies;
drop policy if exists seo_strategies_ins on public.seo_strategies;
drop policy if exists seo_strategies_upd on public.seo_strategies;
drop policy if exists seo_strategies_del on public.seo_strategies;
create policy seo_strategies_sel on public.seo_strategies for select
  using (tenant_id in (select current_tenant_ids()));
create policy seo_strategies_ins on public.seo_strategies for insert with check (
  tenant_id in (select tenant_id from memberships
    where user_id = (select auth.uid()) and status = 'active' and role in ('owner','admin')));
create policy seo_strategies_upd on public.seo_strategies for update using (
  tenant_id in (select tenant_id from memberships
    where user_id = (select auth.uid()) and status = 'active' and role in ('owner','admin'))
) with check (
  tenant_id in (select tenant_id from memberships
    where user_id = (select auth.uid()) and status = 'active' and role in ('owner','admin')));
create policy seo_strategies_del on public.seo_strategies for delete using (
  tenant_id in (select tenant_id from memberships
    where user_id = (select auth.uid()) and status = 'active' and role in ('owner','admin')));

-- =====================================================================
-- 初期データ: カトルセHP（法人）の戦略
--   目標 月¥300万（ユーザー決定 2026-07-29）。想定レートは本番実績
--   （成約率48.5% / 受注単価 中央値¥180万）を初期値として置く。
--   クラスタは戦略ドキュメント §4.2 の5分類。
-- =====================================================================
insert into public.seo_strategies (
  tenant_id, site_id, name, period_from, period_to, target_monthly_revenue,
  assumed_deal_amount, assumed_win_rate, assumed_opp_rate, assumed_valid_rate,
  assumed_inquiry_cvr, assumed_ctr, current_phase, note_md
)
select s.tenant_id, s.id, '2026下期 集客戦略（法人）',
       current_date, (current_date + interval '12 months')::date, 3000000,
       1800000, 0.485, 0.25, 0.70, 0.02, 0.04, 'phase0',
       '戦略の全文は docs/SEO_STRATEGY_2026-07.md。四半期に1回見直す。'
from public.seo_sites s
where s.is_primary and s.tenant_id = '00000000-0000-0000-0000-000000000001'
  and not exists (select 1 from public.seo_strategies x where x.site_id = s.id);

insert into public.seo_clusters (tenant_id, site_id, name, target_article_count, priority, status, note)
select s.tenant_id, s.id, v.name, v.target, v.priority, v.status, v.note
from public.seo_sites s
cross join (values
  ('生成AI企業研修', 10, 1, 'active',
   '主力。検索需要が最大かつ商用意図が明確。戦力の50%を投下する'),
  ('AI顧問', 8, 2, 'planned',
   'ストック収益でLTV最大。研修クラスタからの内部送客が効く'),
  ('AI開発・業務自動化', 8, 3, 'planned',
   '単価最大だが検討期間が長い。第2層記事から時間をかけて育てる'),
  ('営業AX', 6, 4, 'planned',
   'このCRM自体が実績。競合が少ない穴場'),
  ('SNS支援', 4, 5, 'out_of_scope',
   'X等の自社チャネルが主戦場。SEOは後回しでよい')
) as v(name, target, priority, status, note)
where s.is_primary and s.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict (site_id, name) do nothing;

-- 90日ロードマップ（戦略ドキュメント §9）
insert into public.seo_strategy_milestones (tenant_id, strategy_id, phase, seq, title, due_date)
select st.tenant_id, st.id, v.phase, v.seq, v.title, (current_date + v.days)::date
from public.seo_strategies st
cross join (values
  ('phase0', 1, 'GSC/GA4接続・計測開始', 14),
  ('phase0', 2, '全ページの検索意図3層分類（棚卸し）', 14),
  ('phase0', 3, 'ターゲットKW台帳の作成（100〜200語）', 14),
  ('phase0', 4, 'ベースライン数値の確定', 14),
  ('phase1', 1, '順位11〜20位KWの押し上げ（タイトル/メタ/リライト）', 42),
  ('phase1', 2, 'CTR機会損失ページの改善', 42),
  ('phase1', 3, '孤立ページへの内部リンク追加', 42),
  ('phase1', 4, '料金の目安ページを新設', 42),
  ('phase1', 5, 'フォーム項目の削減・記事ごとの資料DL設置', 42),
  ('phase2', 1, '研修クラスタ: ピラーページ強化', 84),
  ('phase2', 2, '研修クラスタ: 記事5本公開', 84),
  ('phase2', 3, '導入事例3本の公開', 84),
  ('phase2', 4, '商談起点のネタ抽出フローを稼働', 84),
  ('phase3', 1, 'AI顧問クラスタの構築', 180),
  ('phase3', 2, '独自調査リリース（被リンク獲得）', 180),
  ('phase3', 3, '勝ちパターンの横展開', 180)
) as v(phase, seq, title, days)
where st.status = 'active'
  and not exists (
    select 1 from public.seo_strategy_milestones m
    where m.strategy_id = st.id and m.phase = v.phase and m.seq = v.seq
  );
