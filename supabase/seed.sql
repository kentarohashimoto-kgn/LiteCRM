-- =====================================================================
-- CATORCE 初期テンプレート seed (要件 8章)
-- CATORCE固有情報はコードにハードコードせず、seed/設定として投入する。
-- 他テナント展開時はこのファイルを複製してマスタを差し替える。
-- =====================================================================

-- ---- テナント ----
insert into tenants (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', '株式会社カトルセ', 'catorce')
on conflict (slug) do nothing;

-- 以降、CATORCEテナントID
do $$
declare t uuid := '00000000-0000-0000-0000-000000000001';
begin
  -- 流入経路 (8.2)
  insert into lead_sources (tenant_id, name, description) values
    (t,'X','X投稿、プロフィール、DM経由'),
    (t,'紹介','顧客・知人・パートナーからの紹介'),
    (t,'既存顧客','アップセル/クロスセル'),
    (t,'LP','Webサイト/LP問い合わせ'),
    (t,'SEO','オーガニック検索'),
    (t,'ウェビナー','セミナー/オンラインイベント'),
    (t,'展示会','展示会QR/名刺/ノベルティ'),
    (t,'交流会','自社/外部交流会'),
    (t,'営業代行','外部営業経由'),
    (t,'代理店','パートナー/代理店経由'),
    (t,'Facebook','Facebook営業/DM'),
    (t,'LinkedIn','LinkedIn経由'),
    (t,'メルマガ','メール配信経由'),
    (t,'その他','その他')
  on conflict do nothing;

  -- 商材 (8.1)
  insert into products (tenant_id, category, name, notes, is_recurring, default_price, default_gross_profit_rate) values
    (t,'AI研修','生成AI企業研修','主力商材',false,1500000,0.70),
    (t,'AI研修','Dify研修','AIエージェント/ワークフロー',false,1200000,0.70),
    (t,'AI研修','Copilot研修','Microsoft系',false,1000000,0.70),
    (t,'AI研修','NotebookLM研修','業務プロンプト/資料活用',false,800000,0.72),
    (t,'AI研修','Gemini研修','Google Workspace系',false,900000,0.70),
    (t,'AI顧問','AI顧問ライト','月額顧問',true,150000,0.80),
    (t,'AI顧問','AI顧問スタンダード','月額顧問',true,300000,0.80),
    (t,'AI顧問','AI顧問エンタープライズ','月額顧問',true,600000,0.78),
    (t,'AI開発','Dify/RAG開発','受託開発',false,3000000,0.45),
    (t,'AI開発','AIエージェント開発','受託/PoC',false,2500000,0.45),
    (t,'AI開発','議事録AI','業務自動化',true,500000,0.60),
    (t,'SaaS/商品','すらつく','AIスライド作成パッケージ',true,50000,0.85),
    (t,'SNS支援','Xジム','X発信支援',true,200000,0.75),
    (t,'SNS支援','FBGYM','Facebook営業支援',true,200000,0.75),
    (t,'営業AX','営業AX支援','CRM/SFA/営業AI化支援',true,800000,0.60),
    (t,'展示会','プロンプト100選導線','展示会リード獲得',false,300000,0.70)
  on conflict do nothing;

  -- 今月から6ヶ月の売上目標
  insert into sales_targets (tenant_id, target_month, target_amount, target_gross_profit)
  select t, (date_trunc('month', current_date) + (n || ' month')::interval)::date, 6000000, 4000000
  from generate_series(0,5) as n
  on conflict (tenant_id, target_month) do nothing;
end $$;

-- ---- メンバー(ロール)について ----
-- memberships は auth.users(Supabase Auth) のユーザー作成後に投入する。
-- 例:
--   insert into memberships (tenant_id, user_id, role)
--   values ('00000000-0000-0000-0000-000000000001', '<auth_user_uuid>', 'owner');
