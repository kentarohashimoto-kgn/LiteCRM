-- =====================================================================
-- プレゼンモード: デモ専用テナント + ダミーデータ生成
-- 目的: 各営業マンが実データを見せずに、リアル感あるデモでプレゼンできる。
-- 方式: 既存のマルチテナント基盤を活用し「デモテナント」を1つ作る。
--        プレゼンモード = アクティブテナントをデモへ切替(session.ts + cookie)。
--        全画面/RPC/RLS は無改修で、扱うデータだけがデモに切り替わる。
--
-- 安全性:
--   - 本ファイルは is_demo 列の追加と、デモテナント配下の行の投入のみ。
--     既存(カトルセ)テナントのデータには一切触れない。
--   - データ生成/初期化は必ず tenant_id = デモ に限定(reset_demo_tenant)。
--   - デモの営業メンバーは auth.users に作るがログイン不可(パスワード無効)。
--
-- 想定シナリオ: AI研修/顧問/開発を手掛ける成長企業。年商 約7億(5〜10億レンジ)。
--   目標 月7,000万(年8.4億)に対し達成率 約8割 → 目標未達・大型案件の停滞・
--   顧客集中といった「経営課題」も内包したリアルなデータにしている。
-- =====================================================================

-- ---- 1. is_demo フラグ ----
alter table tenants add column if not exists is_demo boolean not null default false;

-- ---- 2. デモテナント本体 ----
insert into tenants (id, name, slug, status, is_demo)
values ('00000000-0000-0000-0000-0000000000de', '株式会社アークサイド（デモ）', 'demo', 'active', true)
on conflict (id) do update set is_demo = true, name = excluded.name;

insert into tenant_settings (tenant_id, settings)
values ('00000000-0000-0000-0000-0000000000de', '{}'::jsonb)
on conflict (tenant_id) do nothing;

-- ---- 3. デモ営業チーム(auth.users → profiles 自動生成 → memberships) ----
-- ログイン不可(encrypted_password はランダムで既知の平文と一致しない)。
-- profiles は on_auth_user_created トリガが display_name/avatar_color を反映して自動作成。
do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_ids uuid[] := array[
    'd0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000003',
    'd0000000-0000-0000-0000-000000000004',
    'd0000000-0000-0000-0000-000000000005',
    'd0000000-0000-0000-0000-000000000006'
  ]::uuid[];
  v_names text[] := array['高橋 誠','佐藤 由紀','田中 健太','鈴木 彩香','渡辺 大輔','山本 直人'];
  v_colors text[] := array['#008C8C','#F59A2A','#8B5CF6','#3B82F6','#E11D48','#10B981'];
  v_roles text[] := array['sales_rep','sales_rep','sales_rep','sales_rep','sales_rep','sales_manager'];
  i int;
begin
  for i in 1..array_length(v_ids,1) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_ids[i], 'authenticated', 'authenticated',
      'demo-rep' || i || '@presentation.catorce.local',
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', v_names[i], 'avatar_color', v_colors[i])
    )
    on conflict (id) do nothing;

    -- profiles はトリガで作られるが、既存時のために明示的にも整える
    insert into profiles (id, email, display_name, avatar_color)
    values (v_ids[i], 'demo-rep' || i || '@presentation.catorce.local', v_names[i], v_colors[i])
    on conflict (id) do update set display_name = excluded.display_name, avatar_color = excluded.avatar_color;

    insert into memberships (tenant_id, user_id, role, status)
    values (v_tenant, v_ids[i], v_roles[i], 'active')
    on conflict (tenant_id, user_id) do update set status = 'active', role = excluded.role;
  end loop;
end $$;

-- ---- 4. デモ用マスタ(流入経路 / 商材) ----
do $$
declare v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
begin
  if not exists (select 1 from lead_sources where tenant_id = v_tenant) then
    insert into lead_sources (tenant_id, name, description) values
      (v_tenant,'X','X投稿・DM経由'),
      (v_tenant,'紹介','顧客・パートナー紹介'),
      (v_tenant,'既存顧客','アップセル/クロスセル'),
      (v_tenant,'LP','Web/LP問い合わせ'),
      (v_tenant,'SEO','オーガニック検索'),
      (v_tenant,'ウェビナー','セミナー/オンライン'),
      (v_tenant,'展示会','展示会リード'),
      (v_tenant,'交流会','交流会経由'),
      (v_tenant,'代理店','代理店経由'),
      (v_tenant,'メルマガ','メール配信経由');
  end if;

  if not exists (select 1 from products where tenant_id = v_tenant) then
    insert into products (tenant_id, category, name, notes, is_recurring, default_price, default_gross_profit_rate) values
      (v_tenant,'AI研修','生成AI企業研修','主力商材',false,1500000,0.70),
      (v_tenant,'AI研修','Dify研修','AIエージェント/ワークフロー',false,1200000,0.70),
      (v_tenant,'AI研修','Copilot研修','Microsoft系',false,1000000,0.70),
      (v_tenant,'AI研修','NotebookLM研修','資料活用',false,800000,0.72),
      (v_tenant,'AI顧問','AI顧問ライト','月額顧問',true,150000,0.80),
      (v_tenant,'AI顧問','AI顧問スタンダード','月額顧問',true,300000,0.80),
      (v_tenant,'AI顧問','AI顧問エンタープライズ','月額顧問',true,600000,0.78),
      (v_tenant,'AI開発','Dify/RAG開発','受託開発',false,3000000,0.45),
      (v_tenant,'AI開発','AIエージェント開発','受託/PoC',false,2500000,0.45),
      (v_tenant,'AI開発','議事録AI','業務自動化',true,500000,0.60),
      (v_tenant,'SaaS/商品','すらつく','AIスライド作成',true,50000,0.85),
      (v_tenant,'営業AX','営業AX支援','CRM/SFA/AI化支援',true,800000,0.60);
  end if;
end $$;

-- =====================================================================
-- 5. デモ業務データ生成関数
--    デモテナント配下のみを削除→再生成。相対日付なのでいつでも「直近の動き」に見える。
--    プレゼン中に自由編集した後の原状回復にも使う。
-- =====================================================================
create or replace function reset_demo_tenant()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_reps uuid[] := array[
    'd0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000004',
    'd0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000006'
  ]::uuid[];
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001'; -- プレゼンター枠(トップ営業)
  v_acc uuid[];
  v_prod uuid[]; v_pname text[]; v_pprice numeric[]; v_prate numeric[]; v_prec boolean[]; v_pcat text[];
  v_src uuid[];
  v_month date := date_trunc('month', current_date)::date;
  v_base text[] := array['第一','東和','日本','関西','みらい','ヒカリ','大和','富士','山手','セントラル','グリーン','アクア','テクノ','コスモ','ニット','サンライズ','明和','太陽','丸信','三宝','昭和','いろは','あすなろ','北斗','匠'];
  v_type text[] := array['製作所','産業','システムズ','工業','商事','物流','食品','電機','化成','精機','ホールディングス','メディカル','エンジニアリング','ソリューションズ','建設','サービス'];
  v_ind  text[] := array['製造','IT・ソフトウェア','商社・卸','物流・運輸','建設・不動産','医療・ヘルスケア','小売・EC','人材・教育','金融・保険','食品・外食'];
  v_area text[] := array['東京','神奈川','大阪','愛知','福岡','北海道','埼玉','兵庫'];
  v_sur  text[] := array['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤','吉田','山田','松本','井上','木村','林','清水','斎藤','山口','森'];
  v_giv  text[] := array['太郎','花子','健一','美咲','大輔','恵子','翔太','由美','拓也','彩','直樹','麻衣','和也','智','裕子','亮'];
  v_amount_cycle numeric[] := array[1500000,2500000,3500000,5000000,7000000,2500000,3500000,10000000,4500000,6000000,2000000,15000000,3000000,5500000]::numeric[];
begin
  -- 安全: デモテナント配下のみ削除(子→親)
  delete from billing_schedules where tenant_id = v_tenant;
  delete from meetings          where tenant_id = v_tenant;
  delete from tasks             where tenant_id = v_tenant;
  delete from activities        where tenant_id = v_tenant;
  delete from stage_histories   where tenant_id = v_tenant;
  delete from opportunity_products where tenant_id = v_tenant;
  delete from opportunities     where tenant_id = v_tenant;
  delete from leads             where tenant_id = v_tenant;
  delete from contacts          where tenant_id = v_tenant;
  delete from accounts          where tenant_id = v_tenant;
  delete from forecast_snapshots where tenant_id = v_tenant;
  delete from sales_targets     where tenant_id = v_tenant;

  -- マスタ配列を取得
  select array_agg(id order by created_at) into v_src from lead_sources where tenant_id = v_tenant;
  select array_agg(id order by created_at), array_agg(name order by created_at),
         array_agg(default_price order by created_at), array_agg(coalesce(default_gross_profit_rate,0.6) order by created_at),
         array_agg(is_recurring order by created_at), array_agg(category order by created_at)
    into v_prod, v_pname, v_pprice, v_prate, v_prec, v_pcat
    from products where tenant_id = v_tenant;

  -- ---- 顧客(80社) ----
  with ins as (
    insert into accounts (tenant_id, owner_user_id, name, industry, area, employee_size, revenue_size, status, rank, focus, engagement_rank, created_at)
    select
      v_tenant,
      v_reps[1 + (g % 6)],
      '株式会社' || v_base[1 + (g * 7 % array_length(v_base,1))] || v_type[1 + (g * 3 % array_length(v_type,1))],
      v_ind[1 + (g % 10)],
      v_area[1 + (g % 8)],
      (array['1〜50名','51〜100名','101〜300名','301〜1000名','1000名以上'])[1 + (g % 5)],
      (array['1億未満','1〜5億','5〜10億','10〜50億','50億以上'])[1 + ((g / 3) % 5)],
      case when g % 5 < 3 then 'customer' else 'prospect' end,
      (array['S','A','A','B','B','B','C','C'])[1 + (g % 8)],
      (array['critical','important','important','normal','normal','normal','low','hold'])[1 + (g % 8)],
      (array['S','A','B','C'])[1 + (g % 4)],
      (now() - ((g * 4) || ' days')::interval)
    from generate_series(0, 79) g
    returning id
  )
  select array_agg(id) into v_acc from ins;

  -- ---- 担当者(各社1〜2名) ----
  insert into contacts (tenant_id, account_id, name, department, title, email, decision_role, created_at)
  select
    v_tenant, t.a,
    v_sur[1 + ((t.idx * 5 + c) % 20)] || ' ' || v_giv[1 + ((t.idx * 3 + c) % 16)],
    (array['経営企画','情報システム','人事','営業','DX推進','総務'])[1 + ((t.idx + c) % 6)],
    (array['部長','課長','マネージャー','取締役','担当','本部長'])[1 + ((t.idx + c) % 6)],
    'contact' || t.idx || c || '@example.co.jp',
    (array['decision_maker','influencer','user','unknown'])[1 + ((t.idx + c) % 4)],
    now() - ((t.idx * 4) || ' days')::interval
  from unnest(v_acc) with ordinality as t(a, idx),
       generate_series(1, 1 + (t.idx::int % 2)) c;

  -- ---- 商談(230件) 一時表に生成 ----
  create temp table _o on commit drop as
  with base as (
    select
      g,
      v_acc[1 + (g % 80)] as account_id,
      v_reps[1 + (g % 6)] as owner_id,
      (g % 100) as bucket,
      v_prod[1 + (g % 12)] as product_id,
      v_pname[1 + (g % 12)] as pname,
      v_prate[1 + (g % 12)] as prate,
      v_prec[1 + (g % 12)] as prec,
      v_pcat[1 + (g % 12)] as pcat,
      v_amount_cycle[1 + (g % 14)] as amount,
      v_src[1 + (g % greatest(array_length(v_src,1),1))] as source_id
    from generate_series(0, 229) g
  )
  select
    b.g, b.account_id, b.owner_id, b.product_id, b.pname, b.amount,
    round(b.amount * b.prate)::numeric as gross_profit, b.prate as gp_rate, b.source_id,
    case when b.prec then 'advisory_subscription'
         when b.pcat = 'AI開発' then 'development'
         when b.pcat = 'AI研修' then 'training'
         else 'other' end as category,
    -- ステータス/ステージ確定
    case when b.bucket < 57 then 'won'
         when b.bucket < 85 then 'open'
         when b.bucket < 96 then 'lost'
         else 'open' end as status,
    case when b.bucket < 57 then 'won'
         when b.bucket < 85 then (array['meeting_done','needs_confirmed','proposal_preparing','proposal_sent','internal_review','verbal_commit','meeting_scheduled'])[1 + (b.g % 7)]
         when b.bucket < 96 then 'lost'
         else 'on_hold' end as stage,
    b.prec
  from base b;

  -- ---- opportunities 本体 ----
  insert into opportunities (
    id, tenant_id, account_id, owner_user_id, name, stage, forecast_category, amount,
    gross_profit, gross_profit_rate, probability, status, category, yomi, deal_phase,
    opportunity_type, primary_product_id, lead_source_id,
    expected_revenue_month, expected_close_date, next_action_date, next_action_text,
    last_activity_at, win_reason, lost_reason, budget_status, decision_maker_status, created_at
  )
  select
    ('e0000000-0000-0000-0000-' || lpad(o.g::text, 12, '0'))::uuid,
    v_tenant, o.account_id, o.owner_id,
    (select name from accounts where id = o.account_id) || ' ' || o.pname || ' 導入',
    o.stage,
    case o.status
      when 'won' then 'commit'
      when 'lost' then 'omitted'
      else case o.stage when 'verbal_commit' then 'commit' when 'internal_review' then 'best_case'
                        when 'proposal_sent' then 'best_case' when 'on_hold' then 'omitted' else 'pipeline' end
    end,
    o.amount, o.gross_profit, o.gp_rate,
    case o.status when 'won' then 100 when 'lost' then 0
      else (array[20,30,45,55,65,75,90])[1 + (o.g % 7)] end,
    case when o.status = 'won' then 'won' when o.status = 'lost' then 'lost' else 'open' end,
    o.category,
    case o.status when 'won' then '0.受注' when 'lost' then '8.キャンセル'
      else (array['4.アポ','3.C(30%)','3.C(30%)','2.B(50%)','1.A(80%)','1.A(80%)','9.調整中'])[1 + (o.g % 7)] end,
    case when o.status = 'open' and o.stage <> 'on_hold'
      then (array['comparison','detailed_review','detailed_review','proposal','estimate','proposal','info_gathering'])[1 + (o.g % 7)] end,
    (array['new','new','existing_upsell','renewal','new','referral'])[1 + (o.g % 6)],
    o.product_id, o.source_id,
    -- 受注: 直近13ヶ月に分散 / 失注: 過去 / 進行中: 当月〜+4ヶ月
    case when o.status = 'won' then (v_month - ((o.g % 13) || ' months')::interval)::date
         when o.status = 'lost' then (v_month - (2 + (o.g % 6) || ' months')::interval)::date
         else (v_month + ((o.g % 5) || ' months')::interval)::date end,
    case when o.status = 'won' then (v_month - ((o.g % 13) || ' months')::interval)::date
         when o.status = 'lost' then (v_month - (2 + (o.g % 6) || ' months')::interval)::date
         else (current_date + (3 + (o.g % 40) || ' days')::interval)::date end,
    -- 進行中は次アクション日: 一部を過去(超過)にして「放置案件」の課題を演出
    case when o.status = 'open' then (current_date + ((o.g % 11) - 4 || ' days')::interval)::date end,
    case when o.status = 'open' then (array['見積提出','稟議フォロー','再提案','日程調整','決裁者面談','条件すり合わせ'])[1 + (o.g % 6)] end,
    -- 直近活動: 一部を古くして stale 判定に載せる
    case when o.status = 'won' then (v_month - ((o.g % 13) || ' months')::interval + '5 days'::interval)
         when o.status = 'lost' then (v_month - (2 + (o.g % 6) || ' months')::interval)
         when o.g % 6 = 0 then (now() - ((14 + o.g % 20) || ' days')::interval)   -- 停滞案件
         else (now() - ((o.g % 6) || ' days')::interval) end,
    case when o.status = 'won' then (array['提案内容が刺さった','価格・スピードで優位','既存関係からの信頼','経営課題に直結'])[1 + (o.g % 4)] end,
    case when o.status = 'lost' then (array['price','competitor','timing','budget_freeze','needs_mismatch'])[1 + (o.g % 5)] end,
    case when o.status = 'open' then (array['confirmed','likely','likely','unknown','next_fy'])[1 + (o.g % 5)] end,
    case when o.status = 'open' then (array['confirmed','not_confirmed','unknown'])[1 + (o.g % 3)] end,
    (now() - ((o.g % 13) * 30 + (o.g % 20) || ' days')::interval)
  from _o o;

  -- ---- 商談商品 ----
  insert into opportunity_products (tenant_id, opportunity_id, product_id, amount, quantity)
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text, 12, '0'))::uuid, o.product_id, o.amount, 1
  from _o o;

  -- ---- ステージ履歴(受注案件の受注記録 + 進行中の直近遷移) ----
  insert into stage_histories (tenant_id, opportunity_id, from_stage, to_stage, changed_by, changed_at)
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text, 12, '0'))::uuid,
    'verbal_commit', 'won', o.owner_id, (v_month - ((o.g % 13) || ' months')::interval + '5 days'::interval)
  from _o o where o.status = 'won'
  union all
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text, 12, '0'))::uuid,
    'meeting_done', o.stage, o.owner_id, (now() - ((o.g % 20) || ' days')::interval)
  from _o o where o.status = 'open' and o.stage <> 'on_hold';

  -- ---- 請求スケジュール(受注: サブスクは継続、単発は都度) ----
  insert into billing_schedules (tenant_id, opportunity_id, account_id, kind, billing_date, amount, recurring_start_month, recurring_end_month, created_by)
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text, 12, '0'))::uuid, o.account_id,
    case when o.prec then 'recurring' else 'one_time' end,
    case when o.prec then null else (v_month - ((o.g % 13) || ' months')::interval + '15 days'::interval)::date end,
    case when o.prec then greatest(round(o.amount / 12), 50000) else o.amount end,
    case when o.prec then (v_month - ((o.g % 13) || ' months')::interval)::date end,
    case when o.prec then (v_month + ((11 - (o.g % 6)) || ' months')::interval)::date end,
    o.owner_id
  from _o o where o.status = 'won';

  -- ---- 商談メモ(activities): 各進行中/受注案件に2〜3件 ----
  insert into activities (tenant_id, account_id, opportunity_id, owner_user_id, activity_type, title, body, activity_at)
  select v_tenant, o.account_id, ('e0000000-0000-0000-0000-' || lpad(o.g::text, 12, '0'))::uuid, o.owner_id,
    (array['meeting','call','email','proposal','follow_up'])[1 + ((o.g + c) % 5)],
    (array['初回商談','フォロー架電','提案メール送付','見積提示','課題ヒアリング','稟議状況の確認'])[1 + ((o.g + c) % 6)],
    (array['担当と面談。課題を確認。','不在。再架電予定。','提案書を送付、反応待ち。','見積を提示。予算内で前向き。','決裁フローを確認。','次回までに事例を提示。'])[1 + ((o.g + c) % 6)],
    (now() - (((o.g + c) % 45) || ' days')::interval)
  from _o o, generate_series(1, case when o.status in ('won','open') then 3 else 1 end) c
  where o.status in ('won','open');

  -- ---- 商談(meetings) ----
  insert into meetings (tenant_id, opportunity_id, account_id, owner_user_id, title, meeting_date, method, summary, next_action_date, next_action_text, created_by)
  select v_tenant, ('e0000000-0000-0000-0000-' || lpad(o.g::text, 12, '0'))::uuid, o.account_id, o.owner_id,
    o.pname || ' 商談',
    (current_date - ((o.g % 20) || ' days')::interval)::date,
    (array['オンライン','訪問','オンライン','電話'])[1 + (o.g % 4)],
    (array['課題と予算感を確認。次回提案。','デモを実施、好反応。','決裁者を交え条件を協議。','現場ニーズをヒアリング。'])[1 + (o.g % 4)],
    (current_date + ((o.g % 10) || ' days')::interval)::date,
    '提案・見積のフォロー',
    o.owner_id
  from _o o where o.status = 'open' and o.stage <> 'on_hold' and o.g % 2 = 0;

  -- ---- タスク(90件): 期限は前後に分散(一部超過=課題) ----
  insert into tasks (tenant_id, opportunity_id, account_id, assigned_to, created_by, title, description, due_date, status, priority, created_at)
  select v_tenant,
    ('e0000000-0000-0000-0000-' || lpad((g % 230)::text, 12, '0'))::uuid,
    v_acc[1 + (g % 80)],
    v_reps[1 + (g % 6)], v_reps[1 + (g % 6)],
    (array['提案書作成','見積送付','お礼メール','事例送付','日程調整','稟議フォロー','契約書確認','キックオフ準備'])[1 + (g % 8)],
    'デモ用タスク',
    (current_date + ((g % 14) - 5 || ' days')::interval)::date,
    (array['todo','todo','doing','todo','done','todo'])[1 + (g % 6)],
    (array['high','middle','middle','low','high'])[1 + (g % 5)],
    (now() - ((g % 20) || ' days')::interval)
  from generate_series(0, 89) g;

  -- ---- リード(130件): ファネル/架電結果を分散、一部を案件化済に ----
  insert into leads (tenant_id, account_id, owner_user_id, lead_source_id, title, status, disposition, funnel_stage, rank, industry, acquired_at, converted_at, created_at)
  select v_tenant,
    v_acc[1 + (g % 80)],
    v_reps[1 + (g % 6)],
    v_src[1 + (g % greatest(array_length(v_src,1),1))],
    (array['資料請求','展示会名刺','ウェビナー参加','問い合わせ','紹介','DM反応'])[1 + (g % 6)] || 'リード#' || g,
    case when g % 5 = 0 then 'converted' when g % 7 = 0 then 'disqualified' else 'new' end,
    (array['untouched','calling','no_answer','continuing','appointment','ng','continuing'])[1 + (g % 7)],
    (array['new','new','mql','sql','appointment','nurturing','excluded'])[1 + (g % 7)],
    (array['S','A','B','B','C'])[1 + (g % 5)],
    v_ind[1 + (g % 10)],
    (current_date - ((g % 90) || ' days')::interval)::date,
    case when g % 5 = 0 then (now() - ((g % 40) || ' days')::interval) end,
    (now() - ((g % 90) || ' days')::interval)
  from generate_series(0, 129) g;

  -- ---- 売上目標(直近12ヶ月+今後12ヶ月): 月7,000万(年8.4億) ----
  insert into sales_targets (tenant_id, target_month, target_amount, target_gross_profit)
  select v_tenant, (v_month + (m || ' months')::interval)::date, 70000000, 45000000
  from generate_series(-12, 11) m
  on conflict (tenant_id, target_month) do update set target_amount = excluded.target_amount;

  -- ---- 予測スナップショット(当月+3ヶ月) ----
  insert into forecast_snapshots (tenant_id, snapshot_date, period_month, commit_amount, best_case_amount, pipeline_amount, weighted_amount, target_amount, gap_amount)
  select v_tenant, current_date, (v_month + (m || ' months')::interval)::date,
    c.commit_amt, c.best_amt, c.pipe_amt, round(c.commit_amt + c.best_amt * 0.6 + c.pipe_amt * 0.3),
    70000000, 70000000 - round(c.commit_amt + c.best_amt * 0.6 + c.pipe_amt * 0.3)
  from generate_series(0, 3) m
  cross join lateral (
    select
      coalesce(sum(amount) filter (where forecast_category = 'commit'), 0) as commit_amt,
      coalesce(sum(amount) filter (where forecast_category = 'best_case'), 0) as best_amt,
      coalesce(sum(amount) filter (where forecast_category = 'pipeline'), 0) as pipe_amt
    from opportunities
    where tenant_id = v_tenant and status = 'open'
      and expected_revenue_month = (v_month + (m || ' months')::interval)::date
  ) c;
end $$;

-- 初回投入
select reset_demo_tenant();

-- =====================================================================
-- 6. プレゼンモード開始/終了 RPC
--    プレゼンターを一時的にデモテナントの sales_manager として参加させ、
--    プレゼンター枠(トップ営業)のポートフォリオを本人に付替える。
--    → チーム全体(経営ダッシュボード)も「自分の案件」も充実して見える。
-- =====================================================================
create or replace function enter_presentation_mode()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- 本番テナントに所属している実ユーザーのみ許可(招待経路の悪用防止)
  if not exists (select 1 from memberships m join tenants t on t.id = m.tenant_id
                 where m.user_id = v_uid and m.status = 'active' and t.is_demo = false) then
    raise exception 'presentation mode is only for internal members';
  end if;

  insert into memberships (tenant_id, user_id, role, status)
  values (v_tenant, v_uid, 'sales_manager', 'active')
  on conflict (tenant_id, user_id) do update set status = 'active', role = 'sales_manager';

  if v_uid <> v_slot then
    update opportunities set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update activities    set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update meetings      set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update leads         set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update accounts      set owner_user_id = v_uid where tenant_id = v_tenant and owner_user_id = v_slot;
    update tasks         set assigned_to   = v_uid where tenant_id = v_tenant and assigned_to   = v_slot;
    update tasks         set created_by    = v_uid where tenant_id = v_tenant and created_by    = v_slot;
    update stage_histories set changed_by  = v_uid where tenant_id = v_tenant and changed_by    = v_slot;
    update billing_schedules set created_by = v_uid where tenant_id = v_tenant and created_by   = v_slot;
  end if;
end $$;

create or replace function exit_presentation_mode()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := '00000000-0000-0000-0000-0000000000de';
  v_slot uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_uid = v_slot then return; end if;
  -- 付替えたポートフォリオをデモ枠へ戻す
  update opportunities set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update activities    set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update meetings      set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update leads         set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update accounts      set owner_user_id = v_slot where tenant_id = v_tenant and owner_user_id = v_uid;
  update tasks         set assigned_to   = v_slot where tenant_id = v_tenant and assigned_to   = v_uid;
  update tasks         set created_by    = v_slot where tenant_id = v_tenant and created_by    = v_uid;
  update stage_histories set changed_by  = v_slot where tenant_id = v_tenant and changed_by    = v_uid;
  update billing_schedules set created_by = v_slot where tenant_id = v_tenant and created_by   = v_uid;
end $$;

-- reset は「デモ会社の中の人(=デモテナント参加者)」のみ実行可
create or replace function reset_demo_tenant_guarded()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from memberships where user_id = v_uid
                 and tenant_id = '00000000-0000-0000-0000-0000000000de' and status = 'active') then
    raise exception 'not a demo member';
  end if;
  perform reset_demo_tenant();
end $$;

revoke all on function reset_demo_tenant() from public, authenticated;
grant execute on function enter_presentation_mode() to authenticated;
grant execute on function exit_presentation_mode() to authenticated;
grant execute on function reset_demo_tenant_guarded() to authenticated;
