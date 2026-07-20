-- =====================================================================
-- プレゼンモード 強化: (1)実データとの完全分離 (2)閲覧専用の強制 (3)全体デモ化
--
-- 背景: 初版はプレゼンター参加時に「実テナントの membership も残る」ため、
--   RLSヘルパー current_tenant_ids() が実+デモを union し、RPC系画面で
--   実データが混ざっていた。本マイグレーションでDBレベルで根絶する。
--
-- 方針:
--   (1) presentation_sessions で「今プレゼン中か」を判定し、current_tenant_ids() が
--       プレゼン中はデモのみ / 通常時はデモ除外を返す。全RPC・全RLSが一括で是正。
--   (2) block_demo_writes トリガを全テナントテーブルに付与し、デモデータへの
--       更新系(insert/update/delete)を拒否。システム関数のみ app.demo_seed GUC で許可。
--   (3) reset_demo_tenant を拡張し、タスク管理・案件管理(デリバリー)のデモデータも生成。
-- =====================================================================

-- =====================================================================
-- (1) プレゼンセッション + テナント解決の是正
-- =====================================================================
create table if not exists presentation_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table presentation_sessions enable row level security;
drop policy if exists presentation_sessions_self on presentation_sessions;
create policy presentation_sessions_self on presentation_sessions
  for select using (user_id = auth.uid());

-- 現在ユーザーの有効テナント。プレゼン中(セッション有効)はデモのみ、通常時はデモ除外。
-- これ一箇所で全RLS・全RPCの混在を是正する。
create or replace function current_tenant_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.tenant_id
  from memberships m
  join tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and t.is_demo = (
      exists (
        select 1 from presentation_sessions p
        where p.user_id = auth.uid() and p.expires_at > now()
      )
    );
$$;

-- =====================================================================
-- (2) デモデータ 閲覧専用の強制(DBトリガ)
--   app.demo_seed = '1' のトランザクション(システム関数)のみ書込可。
--   それ以外(アプリのユーザー操作)はデモテナント行への書込を一律拒否。
-- =====================================================================
create or replace function block_demo_writes()
returns trigger language plpgsql as $$
declare
  v_demo uuid := '00000000-0000-0000-0000-0000000000de';
  v_tid uuid;
begin
  if coalesce(current_setting('app.demo_seed', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_tid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  if v_tid = v_demo then
    raise exception 'プレゼンモードは閲覧専用です。デモデータは変更できません。'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- 全テナントテーブルにトリガ付与(tenant_id を持つ public のベーステーブル)。
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
  loop
    execute format('drop trigger if exists trg_block_demo_writes on public.%I', r.table_name);
    execute format('create trigger trg_block_demo_writes before insert or update or delete on public.%I for each row execute function block_demo_writes()', r.table_name);
  end loop;
end $$;

-- =====================================================================
-- (3) デモデータ生成(拡張): 営業 + タスク管理 + 案件管理(デリバリー)
-- =====================================================================
create or replace function reset_demo_tenant()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_reps uuid[] := array['d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000006']::uuid[];
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
  v_acc uuid[];
  v_prod uuid[]; v_pname text[]; v_pprice numeric[]; v_prate numeric[]; v_prec boolean[]; v_pcat text[];
  v_src uuid[];
  v_portfolios uuid[]; v_projects uuid[];
  v_month date := date_trunc('month', current_date)::date;
  v_base text[] := array['第一','東和','日本','関西','みらい','ヒカリ','大和','富士','山手','セントラル','グリーン','アクア','テクノ','コスモ','ニット','サンライズ','明和','太陽','丸信','三宝','昭和','いろは','あすなろ','北斗','匠'];
  v_type text[] := array['製作所','産業','システムズ','工業','商事','物流','食品','電機','化成','精機','ホールディングス','メディカル','エンジニアリング','ソリューションズ','建設','サービス'];
  v_ind  text[] := array['製造','IT・ソフトウェア','商社・卸','物流・運輸','建設・不動産','医療・ヘルスケア','小売・EC','人材・教育','金融・保険','食品・外食'];
  v_area text[] := array['東京','神奈川','大阪','愛知','福岡','北海道','埼玉','兵庫'];
  v_sur  text[] := array['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤','吉田','山田','松本','井上','木村','林','清水','斎藤','山口','森'];
  v_giv  text[] := array['太郎','花子','健一','美咲','大輔','恵子','翔太','由美','拓也','彩','直樹','麻衣','和也','智','裕子','亮'];
  v_amount_cycle numeric[] := array[1500000,2500000,3500000,5000000,7000000,2500000,3500000,10000000,4500000,6000000,2000000,15000000,3000000,5500000]::numeric[];
begin
  perform set_config('app.demo_seed', '1', true);  -- 生成中はデモ書込を許可

  -- 既存デモデータを削除(子→親)
  delete from project_cost_months where tenant_id = v_tenant;
  delete from project_revenue_months where tenant_id = v_tenant;
  delete from project_assignments where tenant_id = v_tenant;
  delete from project_plans where tenant_id = v_tenant;
  delete from task_project_members where tenant_id = v_tenant;
  delete from goals where tenant_id = v_tenant;
  delete from task_sections where tenant_id = v_tenant;
  delete from task_projects where tenant_id = v_tenant;
  delete from task_portfolios where tenant_id = v_tenant;
  delete from billing_schedules where tenant_id = v_tenant;
  delete from meetings where tenant_id = v_tenant;
  delete from tasks where tenant_id = v_tenant;
  delete from activities where tenant_id = v_tenant;
  delete from stage_histories where tenant_id = v_tenant;
  delete from opportunity_products where tenant_id = v_tenant;
  delete from opportunities where tenant_id = v_tenant;
  delete from leads where tenant_id = v_tenant;
  delete from contacts where tenant_id = v_tenant;
  delete from accounts where tenant_id = v_tenant;
  delete from forecast_snapshots where tenant_id = v_tenant;
  delete from sales_targets where tenant_id = v_tenant;

  select array_agg(id order by created_at) into v_src from lead_sources where tenant_id = v_tenant;
  select array_agg(id order by created_at), array_agg(name order by created_at), array_agg(default_price order by created_at), array_agg(coalesce(default_gross_profit_rate,0.6) order by created_at), array_agg(is_recurring order by created_at), array_agg(category order by created_at)
    into v_prod, v_pname, v_pprice, v_prate, v_prec, v_pcat from products where tenant_id = v_tenant;

  -- ---- 顧客(80社) ----
  with ins as (
    insert into accounts (tenant_id, owner_user_id, name, industry, area, employee_size, revenue_size, status, rank, focus, engagement_rank, created_at)
    select v_tenant, v_reps[1 + (g % 6)], '株式会社' || v_base[1 + (g * 7 % array_length(v_base,1))] || v_type[1 + (g * 3 % array_length(v_type,1))], v_ind[1 + (g % 10)], v_area[1 + (g % 8)],
      (array['1〜50名','51〜100名','101〜300名','301〜1000名','1000名以上'])[1 + (g % 5)], (array['1億未満','1〜5億','5〜10億','10〜50億','50億以上'])[1 + ((g/3) % 5)],
      case when g % 5 < 3 then 'customer' else 'prospect' end, (array['S','A','A','B','B','B','C','C'])[1 + (g % 8)], (array['critical','important','important','normal','normal','normal','low','hold'])[1 + (g % 8)], (array['S','A','B','C'])[1 + (g % 4)], (now() - ((g*4) || ' days')::interval)
    from generate_series(0,79) g returning id
  ) select array_agg(id) into v_acc from ins;

  -- ---- 担当者(各社1〜2名) ----
  insert into contacts (tenant_id, account_id, name, department, title, email, decision_role, created_at)
  select v_tenant, t.a, v_sur[1 + ((t.idx*5 + c) % 20)] || ' ' || v_giv[1 + ((t.idx*3 + c) % 16)], (array['経営企画','情報システム','人事','営業','DX推進','総務'])[1 + ((t.idx + c) % 6)], (array['部長','課長','マネージャー','取締役','担当','本部長'])[1 + ((t.idx + c) % 6)], 'contact' || t.idx || c || '@example.co.jp', (array['decision_maker','influencer','user','unknown'])[1 + ((t.idx + c) % 4)], now() - ((t.idx*4) || ' days')::interval
  from unnest(v_acc) with ordinality as t(a, idx), generate_series(1, 1 + (t.idx::int % 2)) c;

  -- ---- 商談(230件) ----
  create temp table _o on commit drop as
  with base as (
    select g, v_acc[1 + (g % 80)] as account_id, v_reps[1 + (g % 6)] as owner_id, (g % 100) as bucket, v_prod[1 + (g % 12)] as product_id, v_pname[1 + (g % 12)] as pname, v_prate[1 + (g % 12)] as prate, v_prec[1 + (g % 12)] as prec, v_pcat[1 + (g % 12)] as pcat, v_amount_cycle[1 + (g % 14)] as amount, v_src[1 + (g % greatest(array_length(v_src,1),1))] as source_id
    from generate_series(0,229) g
  )
  select b.g, b.account_id, b.owner_id, b.product_id, b.pname, b.amount, round(b.amount*b.prate)::numeric as gross_profit, b.prate as gp_rate, b.source_id,
    case when b.prec then 'advisory_subscription' when b.pcat='AI開発' then 'development' when b.pcat='AI研修' then 'training' else 'other' end as category,
    case when b.bucket<57 then 'won' when b.bucket<85 then 'open' when b.bucket<96 then 'lost' else 'open' end as status,
    case when b.bucket<57 then 'won' when b.bucket<85 then (array['meeting_done','needs_confirmed','proposal_preparing','proposal_sent','internal_review','verbal_commit','meeting_scheduled'])[1+(b.g%7)] when b.bucket<96 then 'lost' else 'on_hold' end as stage,
    b.prec from base b;

  insert into opportunities (id, tenant_id, account_id, owner_user_id, name, stage, forecast_category, amount, gross_profit, gross_profit_rate, probability, status, category, yomi, deal_phase, opportunity_type, primary_product_id, lead_source_id, expected_revenue_month, expected_close_date, next_action_date, next_action_text, last_activity_at, win_reason, lost_reason, budget_status, decision_maker_status, created_at)
  select ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, v_tenant, o.account_id, o.owner_id, (select name from accounts where id=o.account_id) || ' ' || o.pname || ' 導入', o.stage,
    case o.status when 'won' then 'commit' when 'lost' then 'omitted' else case o.stage when 'verbal_commit' then 'commit' when 'internal_review' then 'best_case' when 'proposal_sent' then 'best_case' when 'on_hold' then 'omitted' else 'pipeline' end end,
    o.amount, o.gross_profit, o.gp_rate, case o.status when 'won' then 100 when 'lost' then 0 else (array[20,30,45,55,65,75,90])[1+(o.g%7)] end,
    case when o.status='won' then 'won' when o.status='lost' then 'lost' else 'open' end, o.category,
    case o.status when 'won' then '0.受注' when 'lost' then '8.キャンセル' else (array['4.アポ','3.C(30%)','3.C(30%)','2.B(50%)','1.A(80%)','1.A(80%)','9.調整中'])[1+(o.g%7)] end,
    case when o.status='open' and o.stage<>'on_hold' then (array['comparison','detailed_review','detailed_review','proposal','estimate','proposal','info_gathering'])[1+(o.g%7)] end,
    (array['new','new','existing_upsell','renewal','new','referral'])[1+(o.g%6)], o.product_id, o.source_id,
    case when o.status='won' then (v_month - ((o.g%13) || ' months')::interval)::date when o.status='lost' then (v_month - (2+(o.g%6) || ' months')::interval)::date else (v_month + ((o.g%5) || ' months')::interval)::date end,
    case when o.status='won' then (v_month - ((o.g%13) || ' months')::interval)::date when o.status='lost' then (v_month - (2+(o.g%6) || ' months')::interval)::date else (current_date + (3+(o.g%40) || ' days')::interval)::date end,
    case when o.status='open' then (current_date + ((o.g%11)-4 || ' days')::interval)::date end,
    case when o.status='open' then (array['見積提出','稟議フォロー','再提案','日程調整','決裁者面談','条件すり合わせ'])[1+(o.g%6)] end,
    case when o.status='won' then (v_month - ((o.g%13) || ' months')::interval + '5 days'::interval) when o.status='lost' then (v_month - (2+(o.g%6) || ' months')::interval) when o.g%6=0 then (now() - ((14+o.g%20) || ' days')::interval) else (now() - ((o.g%6) || ' days')::interval) end,
    case when o.status='won' then (array['提案内容が刺さった','価格・スピードで優位','既存関係からの信頼','経営課題に直結'])[1+(o.g%4)] end,
    case when o.status='lost' then (array['price','competitor','timing','budget_freeze','needs_mismatch'])[1+(o.g%5)] end,
    case when o.status='open' then (array['confirmed','likely','likely','unknown','next_fy'])[1+(o.g%5)] end,
    case when o.status='open' then (array['confirmed','not_confirmed','unknown'])[1+(o.g%3)] end,
    (now() - ((o.g%13)*30 + (o.g%20) || ' days')::interval) from _o o;

  insert into opportunity_products (tenant_id, opportunity_id, product_id, amount, quantity) select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, o.product_id, o.amount, 1 from _o o;

  insert into stage_histories (tenant_id, opportunity_id, from_stage, to_stage, changed_by, changed_at)
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, 'verbal_commit','won', o.owner_id, (v_month - ((o.g%13) || ' months')::interval + '5 days'::interval) from _o o where o.status='won'
  union all select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, 'meeting_done', o.stage, o.owner_id, (now() - ((o.g%20) || ' days')::interval) from _o o where o.status='open' and o.stage<>'on_hold';

  insert into billing_schedules (tenant_id, opportunity_id, account_id, kind, billing_date, amount, recurring_start_month, recurring_end_month, created_by)
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, o.account_id, case when o.prec then 'recurring' else 'one_time' end,
    case when o.prec then null else (v_month - ((o.g%13) || ' months')::interval + '15 days'::interval)::date end,
    case when o.prec then greatest(round(o.amount/12),50000) else o.amount end,
    case when o.prec then (v_month - ((o.g%13) || ' months')::interval)::date end,
    case when o.prec then (v_month + ((11-(o.g%6)) || ' months')::interval)::date end, o.owner_id from _o o where o.status='won';

  insert into activities (tenant_id, account_id, opportunity_id, owner_user_id, activity_type, title, body, activity_at)
  select v_tenant, o.account_id, ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, o.owner_id, (array['meeting','call','email','proposal','follow_up'])[1+((o.g+c)%5)], (array['初回商談','フォロー架電','提案メール送付','見積提示','課題ヒアリング','稟議状況の確認'])[1+((o.g+c)%6)], (array['担当と面談。課題を確認。','不在。再架電予定。','提案書を送付、反応待ち。','見積を提示。予算内で前向き。','決裁フローを確認。','次回までに事例を提示。'])[1+((o.g+c)%6)], (now() - (((o.g+c)%45) || ' days')::interval)
  from _o o, generate_series(1, case when o.status in ('won','open') then 3 else 1 end) c where o.status in ('won','open');

  insert into meetings (tenant_id, opportunity_id, account_id, owner_user_id, title, meeting_date, method, summary, next_action_date, next_action_text, created_by)
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, o.account_id, o.owner_id, o.pname || ' 商談', (current_date - ((o.g%20) || ' days')::interval)::date, (array['オンライン','訪問','オンライン','電話'])[1+(o.g%4)], (array['課題と予算感を確認。次回提案。','デモを実施、好反応。','決裁者を交え条件を協議。','現場ニーズをヒアリング。'])[1+(o.g%4)], (current_date + ((o.g%10) || ' days')::interval)::date, '提案・見積のフォロー', o.owner_id
  from _o o where o.status='open' and o.stage<>'on_hold' and o.g%2=0;

  insert into leads (tenant_id, account_id, owner_user_id, lead_source_id, title, status, disposition, funnel_stage, rank, industry, acquired_at, converted_at, created_at)
  select v_tenant, v_acc[1+(g%80)], v_reps[1+(g%6)], v_src[1+(g%greatest(array_length(v_src,1),1))], (array['資料請求','展示会名刺','ウェビナー参加','問い合わせ','紹介','DM反応'])[1+(g%6)] || 'リード#' || g, case when g%5=0 then 'converted' when g%7=0 then 'disqualified' else 'new' end, (array['untouched','calling','no_answer','continuing','appointment','ng','continuing'])[1+(g%7)], (array['new','new','mql','sql','appointment','nurturing','excluded'])[1+(g%7)], (array['S','A','B','B','C'])[1+(g%5)], v_ind[1+(g%10)], (current_date - ((g%90) || ' days')::interval)::date, case when g%5=0 then (now() - ((g%40) || ' days')::interval) end, (now() - ((g%90) || ' days')::interval) from generate_series(0,129) g;

  -- ============ タスク管理(Asana型) ============
  with pf as (
    insert into task_portfolios (tenant_id, name, description, color, owner_user_id, status, sort_order)
    values (v_tenant,'全社プロジェクト','部門横断の重点プロジェクト','teal',v_slot,'active',1),
           (v_tenant,'営業企画','営業活動・施策の推進','orange',v_slot,'active',2),
           (v_tenant,'カスタマーサクセス','導入後の顧客支援','violet',v_slot,'active',3)
    returning id
  ) select array_agg(id) into v_portfolios from pf;

  with pj as (
    insert into task_projects (tenant_id, portfolio_id, name, description, color, owner_user_id, status, default_view, start_date, due_date, sort_order)
    select v_tenant, v_portfolios[1 + (g % 3)],
      (array['新CRM導入プロジェクト','展示会2026 出展準備','大型提案 A社','四半期セミナー企画','オンボーディング改善','ナレッジ整備'])[1+g],
      'デモ用プロジェクト',
      (array['teal','orange','violet','sky','amber','lime'])[1+g],
      v_reps[1 + (g % 6)], 'active', 'board',
      (current_date - ((g*7) || ' days')::interval)::date,
      (current_date + ((30 + g*10) || ' days')::interval)::date, g
    from generate_series(0,5) g returning id
  ) select array_agg(id) into v_projects from pj;

  insert into task_sections (tenant_id, project_id, name, sort_order)
  select v_tenant, p, sec.name, sec.i
  from unnest(v_projects) p cross join (values ('未着手',1),('進行中',2),('レビュー',3),('完了',4)) sec(name,i);

  insert into task_project_members (tenant_id, project_id, user_id, added_by)
  select v_tenant, p, r, v_slot from unnest(v_projects) p cross join unnest(v_reps) r;

  insert into goals (tenant_id, portfolio_id, name, metric_kind, target_value, current_value, unit, status, owner_user_id, period_start, period_end, sort_order)
  values
    (v_tenant, v_portfolios[1], '年間受注 8.4億円', 'number', 840000000, 666000000, '円', 'at_risk', v_slot, (v_month - '6 months'::interval)::date, (v_month + '6 months'::interval)::date, 1),
    (v_tenant, v_portfolios[2], '月間アポ 30件', 'number', 30, 24, '件', 'on_track', v_reps[2], v_month, (v_month + '1 month'::interval)::date, 2),
    (v_tenant, v_portfolios[3], '解約率 5%未満', 'number', 5, 4, '%', 'on_track', v_reps[3], (v_month - '3 months'::interval)::date, (v_month + '3 months'::interval)::date, 3),
    (v_tenant, v_portfolios[1], '新規顧客 40社', 'number', 40, 31, '社', 'at_risk', v_slot, (v_month - '6 months'::interval)::date, (v_month + '6 months'::interval)::date, 4);

  -- タスク(120件): 一部は商談紐付き、一部はプロジェクト/セクション配下。期限は前後に分散(超過=課題)。
  insert into tasks (tenant_id, opportunity_id, account_id, assigned_to, created_by, title, description, due_date, status, priority, project_id, section_id, sort_order, created_at)
  select v_tenant,
    case when g % 3 = 0 then ('e0000000-0000-0000-0000-' || lpad((g % 230)::text, 12, '0'))::uuid else null end,
    v_acc[1 + (g % 80)],
    v_reps[1 + (g % 6)], v_reps[1 + (g % 6)],
    (array['提案書作成','見積送付','お礼メール','事例送付','日程調整','稟議フォロー','契約書確認','キックオフ準備','要件ヒアリング','デモ環境準備','議事録展開','請求書発行'])[1 + (g % 12)],
    'デモ用タスク',
    (current_date + ((g % 21) - 7 || ' days')::interval)::date,
    (array['todo','todo','doing','todo','done','doing'])[1 + (g % 6)],
    (array['high','middle','middle','low','high'])[1 + (g % 5)],
    v_projects[1 + (g % 6)],
    (select s.id from task_sections s where s.project_id = v_projects[1 + (g % 6)] order by s.sort_order limit 1 offset (g % 4)),
    g,
    (now() - ((g % 25) || ' days')::interval)
  from generate_series(0, 119) g;

  -- ============ 案件管理(デリバリー原価/粗利): 受注した開発案件に計画 ============
  insert into project_plans (id, tenant_id, opportunity_id, account_id, start_month, end_month, status, created_by, hours_per_month, priority, notes)
  select ('a0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, o.account_id,
    (v_month - '1 month'::interval)::date, (v_month + '4 months'::interval)::date, 'active', o.owner_id, 160, (array['high','middle','low'])[1+(o.g%3)], 'デモ用デリバリー計画'
  from _o o where o.status='won' and o.category='development';

  insert into project_assignments (id, tenant_id, plan_id, kind, member_user_id, label, role, cost_rate, bill_rate, start_month, end_month, status)
  select ('b0000000-0000-0000-0000-' || lpad((o.g*3 + k)::text,12,'0'))::uuid, v_tenant, ('a0000000-0000-0000-0000-' || lpad(o.g::text,12,'0'))::uuid, 'member',
    v_reps[1 + ((o.g + k) % 6)], (array['PM','エンジニア','デザイナー'])[1+k], (array['pm','engineer','designer'])[1+k], (array[800000,700000,650000])[1+k], (array[1400000,1100000,950000])[1+k],
    (v_month - '1 month'::interval)::date, (v_month + '4 months'::interval)::date, 'active'
  from _o o cross join generate_series(0,1) k where o.status='won' and o.category='development';

  insert into project_cost_months (tenant_id, plan_id, assignment_id, month, man_month, ratio, cost_amount)
  select v_tenant, pa.plan_id, pa.id, (pa.start_month + (mm || ' months')::interval)::date, 1.0, 1.0, pa.cost_rate
  from project_assignments pa cross join generate_series(0,4) mm
  where pa.tenant_id = v_tenant;

  insert into project_revenue_months (tenant_id, plan_id, month, amount)
  select v_tenant, pp.id, (pp.start_month + (mm || ' months')::interval)::date, round((select amount from opportunities o where o.id = pp.opportunity_id) / 5.0)
  from project_plans pp cross join generate_series(0,4) mm
  where pp.tenant_id = v_tenant;

  -- ---- 売上目標(前後12ヶ月): 月7,000万 ----
  insert into sales_targets (tenant_id, target_month, target_amount, target_gross_profit) select v_tenant, (v_month + (m || ' months')::interval)::date, 70000000, 45000000 from generate_series(-12,11) m on conflict (tenant_id, target_month) do update set target_amount=excluded.target_amount;

  insert into forecast_snapshots (tenant_id, snapshot_date, period_month, commit_amount, best_case_amount, pipeline_amount, weighted_amount, target_amount, gap_amount)
  select v_tenant, current_date, (v_month + (m || ' months')::interval)::date, c.commit_amt, c.best_amt, c.pipe_amt, round(c.commit_amt + c.best_amt*0.6 + c.pipe_amt*0.3), 70000000, 70000000 - round(c.commit_amt + c.best_amt*0.6 + c.pipe_amt*0.3)
  from generate_series(0,3) m cross join lateral (select coalesce(sum(amount) filter (where forecast_category='commit'),0) as commit_amt, coalesce(sum(amount) filter (where forecast_category='best_case'),0) as best_amt, coalesce(sum(amount) filter (where forecast_category='pipeline'),0) as pipe_amt from opportunities where tenant_id=v_tenant and status='open' and expected_revenue_month=(v_month + (m || ' months')::interval)::date) c;
end $fn$;

-- =====================================================================
-- (4) enter/exit: presentation_sessions を管理し、presenter を owner として参加。
--     プレゼンター枠のポートフォリオ(商談/タスク等)を本人に付替え、個人ビューも充実。
-- =====================================================================
create or replace function enter_presentation_mode()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from memberships m join tenants t on t.id = m.tenant_id where m.user_id = v_uid and m.status = 'active' and t.is_demo = false) then
    raise exception 'presentation mode is only for internal members';
  end if;
  perform set_config('app.demo_seed', '1', true);

  insert into memberships (tenant_id, user_id, role, status) values (v_tenant, v_uid, 'owner', 'active')
  on conflict (tenant_id, user_id) do update set status = 'active', role = 'owner';

  insert into presentation_sessions (user_id, expires_at) values (v_uid, now() + interval '12 hours')
  on conflict (user_id) do update set started_at = now(), expires_at = now() + interval '12 hours';

  if v_uid <> v_slot then
    update opportunities set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update activities    set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update meetings      set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update leads         set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update accounts      set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update tasks         set assigned_to   = v_uid where tenant_id = v_tenant and assigned_to   = v_slot;
    update tasks         set created_by    = v_uid where tenant_id = v_tenant and created_by    = v_slot;
    update task_projects set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update stage_histories set changed_by  = v_uid where tenant_id = v_tenant and changed_by    = v_slot;
    update billing_schedules set created_by = v_uid where tenant_id = v_tenant and created_by   = v_slot;
  end if;
end $fn$;

create or replace function exit_presentation_mode()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform set_config('app.demo_seed', '1', true);
  delete from presentation_sessions where user_id = v_uid;
  if v_uid = v_slot then return; end if;
  update opportunities set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update activities    set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update meetings      set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update leads         set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update accounts      set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update tasks         set assigned_to   = v_slot where tenant_id = v_tenant and assigned_to   = v_uid;
  update tasks         set created_by    = v_slot where tenant_id = v_tenant and created_by    = v_uid;
  update task_projects set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update stage_histories set changed_by  = v_slot where tenant_id = v_tenant and changed_by    = v_uid;
  update billing_schedules set created_by = v_slot where tenant_id = v_tenant and created_by   = v_uid;
end $fn$;

-- reset ガード付き(デモ参加者のみ)。
create or replace function reset_demo_tenant_guarded()
returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from memberships where user_id = v_uid and tenant_id = '00000000-0000-0000-0000-0000000000de' and status = 'active') then
    raise exception 'not a demo member';
  end if;
  perform reset_demo_tenant();
end $fn$;

revoke all on function reset_demo_tenant() from public, authenticated;
grant execute on function enter_presentation_mode() to authenticated;
grant execute on function exit_presentation_mode() to authenticated;
grant execute on function reset_demo_tenant_guarded() to authenticated;

-- 拡張データを再生成
select reset_demo_tenant();
