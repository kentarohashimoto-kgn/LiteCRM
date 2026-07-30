-- =====================================================================
-- 0186: ターゲットKW台帳と順位トラッキング（F-307 / 仮説駆動への転換）
--   背景: docs/SEO_STRATEGY_V2_KEYWORD_DRIVEN_2026-07.md
--
--   従来の実装は「Search Consoleに出てきた語を磨く」対処療法だった。
--   本来のSEOコンサルは「狙う語を仮説で決める → 何位取れたか測る →
--   取れない理由を competitor から学ぶ」という順序で動く。
--   その「狙う語を決める」器を主役にするための追加。
--
--   1) seo_keywords に 想定検索数・目標順位・仮説・競合メモ を追加
--   2) 初期投入: カトルセAI事業の仮説KW 39語（第1層29 / 第2層10）
--   3) RPC seo_keyword_rankings … 台帳KW × 週次順位 × 前週比 × 実表示ページ
--   4) RPC seo_keyword_gap … 未対応/圏外/11-20位/10位以内 の4分類
--
--   ロールバック:
--     drop function seo_keyword_gap, seo_keyword_rankings;
--     delete from seo_keywords where added_reason = 'initial_hypothesis';
-- =====================================================================

alter table public.seo_keywords add column if not exists search_volume int;
alter table public.seo_keywords add column if not exists target_position int;
alter table public.seo_keywords add column if not exists hypothesis text;
alter table public.seo_keywords add column if not exists competitor_note text;
alter table public.seo_keywords add column if not exists added_reason text;
alter table public.seo_keywords add column if not exists status text not null default 'active';

comment on column public.seo_keywords.search_volume is '想定月間検索数。優先順位付けの参考値。順位判定はGSC実データで行うため不正確でも運用は成立する';
comment on column public.seo_keywords.target_position is '狙う順位。ここに届いているかがKW単位の合否';
comment on column public.seo_keywords.competitor_note is '上位競合のURLと、自社に無い要素・自社にしか無い要素のメモ';
comment on column public.seo_keywords.added_reason is 'initial_hypothesis|manual|discovered(拾い物からの昇格)';

create index if not exists idx_seo_keywords_status
  on public.seo_keywords(site_id, status, intent_layer, priority);

-- ---- 初期投入: カトルセAI事業の仮説KW ----
-- 「誰が、どんな状況で、何と検索して発注先を探すか」から逆算した語。
-- 検索数は推定。正確な値はキーワードプランナーで更新する。
insert into public.seo_keywords (
  tenant_id, site_id, cluster_id, query, intent_layer, search_volume, target_position,
  priority, hypothesis, added_reason
)
select
  s.tenant_id, s.id,
  (select c.id from seo_clusters c where c.site_id = s.id and c.name = v.cluster),
  v.query, v.layer, v.volume, v.target_pos, v.priority, v.hypothesis, 'initial_hypothesis'
from public.seo_sites s
cross join (values
  -- 第1層: 発注検討層（今すぐ客）。CVRが最も高く、最優先
  ('生成AI企業研修','生成AI研修',1000,5,1,1,'研修計画に生成AIを入れる人事が最初に打つ語'),
  ('生成AI企業研修','生成AI研修 会社',300,3,1,1,'発注先を探している。最も商用意図が高い'),
  ('生成AI企業研修','生成AI研修 費用',200,3,1,1,'予算検討段階。料金ページで取る'),
  ('生成AI企業研修','生成AI研修 法人',150,3,1,1,'法人向けであることを明示した語'),
  ('生成AI企業研修','AI研修 企業',500,5,1,2,'研修の一般語＋企業。比較検討層'),
  ('生成AI企業研修','AI研修 費用',300,3,1,1,'予算検討。料金ページで取る'),
  ('生成AI企業研修','企業向け ChatGPT研修',200,3,1,2,'ツール名指定。導入済み企業の底上げニーズ'),
  ('生成AI企業研修','ChatGPT研修 法人',150,3,1,2,'同上'),
  ('生成AI企業研修','生成AI 社内研修',400,5,1,1,'内製化を検討する情シス・人事'),
  ('生成AI企業研修','生成AI 研修 おすすめ',200,5,1,2,'比較検討。導入事例で取る'),
  ('生成AI企業研修','Copilot研修 法人',100,3,1,2,'M365導入済みで使われていない企業'),
  ('生成AI企業研修','Dify 研修',100,3,1,3,'自社商材と一致。競合が少ない'),
  ('生成AI企業研修','NotebookLM 研修',50,3,1,3,'同上。ニッチだが確実に取れる'),
  ('生成AI企業研修','生成AI 内製化 支援',100,5,1,2,'研修＋顧問の両方に繋がる'),
  ('生成AI企業研修','生成AI人材育成',200,5,1,2,'人事の予算名目で使われる語'),
  ('AI顧問','AI顧問',500,3,1,1,'自社商材名。ストック収益に直結'),
  ('AI顧問','AI顧問 費用',100,3,1,1,'予算検討段階'),
  ('AI顧問','生成AI コンサル',500,5,1,2,'顧問の一般語'),
  ('AI顧問','生成AIコンサルティング 会社',200,3,1,1,'発注先探し'),
  ('AI顧問','AI導入支援 会社',300,5,1,2,'同上。研修にも繋がる'),
  ('AI顧問','生成AI 導入支援',400,5,1,2,'導入フェーズ全体のニーズ'),
  ('AI開発・業務自動化','Dify 開発 会社',100,3,1,3,'自社実績あり。競合が少ない'),
  ('AI開発・業務自動化','RAG 開発 会社',100,3,1,3,'同上'),
  ('AI開発・業務自動化','AIエージェント 開発 会社',150,3,1,3,'単価最大の商材'),
  ('AI開発・業務自動化','議事録AI 法人',200,5,1,3,'自社プロダクトあり'),
  ('AI開発・業務自動化','社内AI 開発 費用',100,5,1,3,'予算検討'),
  ('営業AX','営業 AI 活用',500,5,1,4,'このCRM自体が実績として使える'),
  ('営業AX','営業DX 支援 会社',200,5,1,4,'発注先探し'),
  ('営業AX','営業 生成AI 活用',200,5,1,4,'同上'),
  -- 第2層: 課題認識層（そのうち客）。資料DLでリード化する
  ('生成AI企業研修','生成AI 社内 定着しない',200,5,2,1,'研修の必要性を自覚した瞬間の語。最も研修に近い第2層'),
  ('生成AI企業研修','生成AI 研修 効果',150,5,2,2,'効果測定への不安。導入事例で答える'),
  ('生成AI企業研修','ChatGPT 社内ルール',800,5,2,1,'検索数が多く、ガイドライン資料DLに繋げやすい'),
  ('生成AI企業研修','生成AI ガイドライン 企業',500,5,2,1,'同上。資料DLの主力'),
  ('生成AI企業研修','生成AI 情報漏洩 対策',400,5,2,2,'情シスの懸念。研修内容の一部として答える'),
  ('生成AI企業研修','社員 AI 使えない',100,5,2,2,'現場管理職の悩み'),
  ('生成AI企業研修','生成AI 業務効率化 事例',1000,8,2,1,'検索数最大の第2層。事例記事で取り、研修へ送る'),
  ('生成AI企業研修','AI導入 失敗',300,5,2,2,'失注理由を一次情報として書ける'),
  ('生成AI企業研修','生成AI 活用事例 製造業',300,5,2,3,'業種別。深掘りしやすい'),
  ('生成AI企業研修','AI研修 内容',200,5,2,2,'カリキュラムページで取る')
) as v(cluster, query, volume, target_pos, layer, priority, hypothesis)
where s.is_primary and s.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict (site_id, query) do nothing;

-- ---- RPC: 台帳KWの順位トラッキング ----
-- 狙った語が「何位取れているか」「前週比でどう動いたか」「どのページで表示されているか」。
-- 対策ページと実表示ページのズレ自体が重要な発見（カニバリ or 対策ページが弱い）。
create or replace function public.seo_keyword_rankings(p_site uuid, p_weeks int default 8)
returns table (
  keyword_id uuid,
  query text,
  intent_layer smallint,
  cluster_name text,
  search_volume int,
  target_position int,
  priority int,
  target_page text,
  current_position numeric,
  prev_position numeric,
  delta numeric,
  impressions bigint,
  clicks bigint,
  ranking_page text,
  page_mismatch boolean,
  gap_status text
)
language sql stable security invoker set search_path = public as $$
  with weeks as (
    select distinct week_start from seo_query_weekly
    where site_id = p_site order by week_start desc limit 2
  ),
  cur_week as (select max(week_start) w from weeks),
  prev_week as (select min(week_start) w from weeks where (select count(*) from weeks) > 1),
  -- 週次のクエリ実績を、表示回数の加重平均でクエリ単位に畳む
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
    k.id, k.query, k.intent_layer,
    c.name,
    k.search_volume, k.target_position, k.priority,
    p.url_path,
    cur.position, prev.position,
    case when cur.position is not null and prev.position is not null
      then round(prev.position - cur.position, 1) end,   -- 正 = 改善
    coalesce(cur.impressions, 0), coalesce(cur.clicks, 0),
    cur.ranking_page,
    -- 対策ページを決めているのにGoogleが別ページを選んでいる状態
    (p.url_path is not null and cur.ranking_page is not null and p.url_path <> cur.ranking_page),
    case
      when cur.position is null and p.url_path is null then 'no_page'   -- 未対応: 対策ページも順位もない
      when cur.position is null then 'out'                              -- 圏外: ページはあるが出ていない
      when cur.position <= 10 then 'top10'
      when cur.position <= 20 then 'striking'
      else 'far'
    end
  from seo_keywords k
  left join seo_clusters c on c.id = k.cluster_id
  left join seo_pages p on p.id = k.target_page_id
  left join cur on cur.query = k.query
  left join prev on prev.query = k.query
  where k.site_id = p_site and k.status = 'active' and k.is_target
  order by k.intent_layer nulls last, k.priority, k.search_volume desc nulls last;
$$;

-- ---- RPC: ギャップの4分類サマリー ----
-- 各分類から打つべき手が一意に決まる:
--   no_page → 新規記事 / out → 作り直し / striking → リライト / top10 → CTR改善
create or replace function public.seo_keyword_gap(p_site uuid)
returns table (
  intent_layer smallint,
  gap_status text,
  keywords int,
  total_volume bigint,
  total_impressions bigint,
  total_clicks bigint
)
language sql stable security invoker set search_path = public as $$
  select r.intent_layer, r.gap_status,
         count(*)::int,
         coalesce(sum(r.search_volume), 0)::bigint,
         coalesce(sum(r.impressions), 0)::bigint,
         coalesce(sum(r.clicks), 0)::bigint
  from seo_keyword_rankings(p_site, 2) r
  group by r.intent_layer, r.gap_status
  order by r.intent_layer nulls last,
    case r.gap_status when 'no_page' then 1 when 'out' then 2 when 'far' then 3
                      when 'striking' then 4 else 5 end;
$$;

comment on function public.seo_keyword_rankings is '狙ったKWの週次順位・前週比・実表示ページ・ギャップ状態。仮説の検証に使う';
comment on function public.seo_keyword_gap is 'ターゲットKWのギャップ4分類。各分類から打つべき手が決まる';
