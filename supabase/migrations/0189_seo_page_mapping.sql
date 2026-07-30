-- =====================================================================
-- 0189: キーワード→対策ページのマッピングと設計の全面修正（F-307c）
--   背景: ユーザーレビュー（2026-07-30）による設計修正。
--   1) 対策URL列の追加 … 1検索意図=1ページ。1KW=1記事の誤解でカニバリを
--      起こさないよう、全KWを記事プラン（=ページ）に必ず紐付ける
--   2) クラスタを9分類に再編 … 「研修につながりそうだから研修クラスタ」を
--      やめ、検索者が何を知りたいかで分類する
--   3) 同一意図の統合 … 法人研修系9語→総合LP1本 / 費用系7語→費用ページ /
--      導入定着系→ピラー1本
--   4) ヌケモレ追加 … 助成金・Claude/バイブコーディング・AIエージェント研修・
--      プロンプト研修・保険/化学・提案書営業資料・提供形式・指名
--   5) 目標順位の二段階化 … 6ヶ月/12ヶ月。表示0のドメインに単発目標は無理筋
--   6) 誤分類の移動 … Dify作り方系→開発 / 議事録AI・SFA・自治体は降格
-- =====================================================================

alter table public.seo_article_plans add column if not exists planned_url text;
alter table public.seo_article_plans add column if not exists page_type text;
alter table public.seo_article_plans add column if not exists is_existing_page boolean not null default false;
alter table public.seo_keywords add column if not exists target_position_6m int;
alter table public.seo_keywords add column if not exists target_position_12m int;

comment on column public.seo_article_plans.planned_url is '対策URL。既存ページならそのパス、新規なら公開時に入れる。カニバリ防止の要';
comment on column public.seo_article_plans.is_existing_page is 'true=既存ページで狙う（リライト/強化）。false=新規作成';
comment on column public.seo_keywords.target_position_6m is '6ヶ月目標順位。表示0のドメインに単発目標は運用できないため二段階にする';

do $$
declare v_site uuid; v_tenant uuid; v_lp uuid; v_pillar uuid;
begin
  select id, tenant_id into v_site, v_tenant
  from seo_sites where is_primary and tenant_id='00000000-0000-0000-0000-000000000001' limit 1;
  if v_site is null then return; end if;

  -- ---- 1) クラスタ9分類へ再編（既存はリネームして参照を維持） ----
  update seo_clusters set name='法人向け生成AI研修', note='中核サービス。総合LP・導入事例・内製化' where site_id=v_site and name='生成AI企業研修';
  update seo_clusters set name='AI顧問・定着支援', note='継続伴走。AI顧問・導入定着ピラー' where site_id=v_site and name='AI顧問';
  update seo_clusters set name='AI開発・自動化', note='開発案件。RAG・Dify・エージェント・議事録' where site_id=v_site and name='AI開発・業務自動化';
  update seo_clusters set note='独自領域。営業研修・提案書AI・SFA/CRM連携' where site_id=v_site and name='営業AX';

  insert into seo_clusters (tenant_id, site_id, name, target_article_count, priority, status, note) values
    (v_tenant, v_site, '研修費用・助成金', 3, 1, 'active', '比較・稟議支援。費用相場と助成金。助成金は商談に最も近いクエリ群'),
    (v_tenant, v_site, 'ツール別研修', 8, 1, 'active', '商談獲得の主力。Copilot/Dify/NotebookLM/Gemini/Claude/エージェント/プロンプト'),
    (v_tenant, v_site, '対象者・部門別研修', 8, 2, 'active', '経営層/管理職/情シス/リーダー育成。推進人材育成は差別化領域'),
    (v_tenant, v_site, 'AIガバナンス', 6, 3, 'active', 'ルール・ガイドライン・情報漏洩。研修と策定支援に接続'),
    (v_tenant, v_site, '業界別AI活用', 8, 3, 'active', '製造・建設・金融・保険・化学。ターゲット業界の専門性訴求')
  on conflict (site_id, name) do nothing;

  -- ---- 2) 総合LPへの統合（法人研修系9語 → 1ページ） ----
  update seo_article_plans set
    main_keyword='生成AI研修',
    title='法人向け生成AI研修｜ChatGPT・Copilot・Gemini・Difyを実務定着',
    page_type='service_lp', is_existing_page=true, priority=1,
    note='既存「AI研修のご案内」ページを全面強化。タイトルが抽象的なので差し替える'
  where site_id=v_site and main_keyword='生成AI研修 会社';
  select id into v_lp from seo_article_plans where site_id=v_site and main_keyword='生成AI研修';

  -- ChatGPT研修プラン・カリキュラムプラン・社内研修プランを総合LPへ統合
  update seo_keywords set article_plan_id=v_lp
  where site_id=v_site and article_plan_id in (
    select id from seo_article_plans where site_id=v_site
      and main_keyword in ('企業向け ChatGPT研修','AI研修 内容'));
  -- 社内研修プラン: 「生成AI 社内研修」自体は総合LPへ、内製化系はリーダー育成へ（後段）
  update seo_keywords set article_plan_id=v_lp
  where site_id=v_site and query in ('生成AI 社内研修');

  -- ---- 3) 導入定着ピラー（導入方法系7語 → 1ページ） ----
  update seo_article_plans set
    title='生成AI導入・社内定着の完全ガイド｜進め方から90日定着まで',
    page_type='pillar', priority=1,
    cluster_id=(select id from seo_clusters where site_id=v_site and name='AI顧問・定着支援'),
    note='90日定着ノウハウという一次情報で勝つピラー。AI顧問への導線'
  where site_id=v_site and main_keyword='生成AI 導入支援';
  select id into v_pillar from seo_article_plans where site_id=v_site and main_keyword='生成AI 導入支援';

  update seo_keywords set article_plan_id=v_pillar
  where site_id=v_site and article_plan_id in (
    select id from seo_article_plans where site_id=v_site and main_keyword='生成AI 社内 定着しない')
    and query <> '生成AI 研修 効果';
  update seo_keywords set article_plan_id=v_lp where site_id=v_site and query='生成AI 研修 効果';

  -- 統合で空になったプランを削除
  delete from seo_article_plans where site_id=v_site
    and main_keyword in ('企業向け ChatGPT研修','AI研修 内容','生成AI 社内 定着しない','生成AI 社内研修');

  -- ---- 4) 誤分類の移動（検索者が何を知りたいかで分類） ----
  -- Dify作り方・導入支援系は開発意図。研修LPに着地させると直帰する
  update seo_keywords set article_plan_id=(select id from seo_article_plans where site_id=v_site and main_keyword='Dify 開発 会社')
  where site_id=v_site and query in ('Dify ワークフロー 作り方','Dify 使い方 企業','Dify 導入 支援');
  -- NotebookLM社内資料はナレッジ活用（RAG）意図
  update seo_keywords set article_plan_id=(select id from seo_article_plans where site_id=v_site and main_keyword='RAG 開発 会社')
  where site_id=v_site and query='NotebookLM 社内資料';

  -- ---- 5) 降格・保留（勝ち筋が言語化できていない語） ----
  update seo_keywords set status='paused',
    competitor_note='Salesforceパートナーが上位を固めるレッドオーシャン。自社CRM/SFAとの絡みでの勝ち筋を言語化してから再開'
  where site_id=v_site and query='SFA 導入支援';
  update seo_article_plans set priority=4,
    note='検索者はNotta等SaaS比較が目的で、開発・研修会社を探していない。上位は比較メディア。書くなら比較記事→自社開発・選定支援へ誘導する設計。優先度低'
  where site_id=v_site and main_keyword='議事録AI 法人';
  update seo_article_plans set priority=5,
    note='ターゲット業界（製造・建設・金融・化学・保険）と異なる公共セグメント。入札・調達まで取りに行く覚悟があるなら残す、なければ削る。要判断'
  where site_id=v_site and main_keyword='自治体 生成AI 研修';

  -- ---- 6) プランのクラスタ再配置 ----
  update seo_article_plans set cluster_id=(select id from seo_clusters where site_id=v_site and name='ツール別研修')
  where site_id=v_site and main_keyword in ('Dify 研修','NotebookLM 研修','Copilot研修 法人','Gemini 研修 法人');
  update seo_article_plans set cluster_id=(select id from seo_clusters where site_id=v_site and name='研修費用・助成金')
  where site_id=v_site and main_keyword='生成AI研修 費用';
  update seo_article_plans set cluster_id=(select id from seo_clusters where site_id=v_site and name='対象者・部門別研修')
  where site_id=v_site and main_keyword in ('生成AI研修 管理職','経営層 AI研修','生成AI研修 新入社員','生成AI人材育成');
  update seo_article_plans set cluster_id=(select id from seo_clusters where site_id=v_site and name='業界別AI活用')
  where site_id=v_site and main_keyword in ('生成AI研修 製造業','生成AI研修 金融','生成AI 建設業 活用','自治体 生成AI 研修','生成AI 業務効率化 事例');
  update seo_article_plans set cluster_id=(select id from seo_clusters where site_id=v_site and name='AIガバナンス')
  where site_id=v_site and main_keyword in ('ChatGPT 社内ルール','生成AI ガイドライン 企業','生成AI 情報漏洩 対策');
  update seo_article_plans set cluster_id=(select id from seo_clusters where site_id=v_site and name='AI顧問・定着支援')
  where site_id=v_site and main_keyword in ('AI導入 失敗');

  -- 既存ページで狙うことが分かっているプラン
  update seo_article_plans set is_existing_page=true,
    note=coalesce(note,'')||' 既存のDify研修ページを法人向け・料金・カスタマイズ・成果物の明記で強化'
  where site_id=v_site and main_keyword='Dify 研修';
  update seo_article_plans set is_existing_page=true,
    note=coalesce(note,'')||' 既存の営業AI活用記事を分岐元に。研修/導入支援/エージェント開発へ誘導'
  where site_id=v_site and main_keyword='営業 生成AI 活用';

  -- ---- 7) 新規プラン（ヌケモレの追加） ----
  insert into seo_article_plans (tenant_id, site_id, cluster_id, title, main_keyword, intent_layer, angle, difficulty, priority, page_role, page_type, is_existing_page, note)
  select v_tenant, v_site,
    (select id from seo_clusters c where c.site_id=v_site and c.name=v.cluster),
    v.title, v.main_kw, 1, v.angle, v.diff, v.pri, v.role, v.ptype, v.existing, v.note
  from (values
    ('研修費用・助成金','生成AI研修に使える助成金｜人材開発支援助成金の活用ガイド','AI研修 助成金',
     '助成金で研修費用を抑えたい人事・経営者。商談に最も近いクエリ群で競合が薄い',2,1,'pricing','article',true,
     '既存の助成金解説ページを研修サービスと接続して強化。最重要の追加'),
    ('ツール別研修','Claude研修（法人向け）｜業務活用からClaude Codeまで','Claude 研修',
     'Claude導入企業・開発部門。自社でClaude Code研修・スクールを実施中',1,1,'service','service_lp',false,
     '競合が薄く伸びている領域で実サービスと直結。claude code系で既に823表示/3.1位の実力がある'),
    ('ツール別研修','AI駆動開発・バイブコーディング研修｜開発生産性を上げる','バイブコーディング 研修',
     '開発部門の生産性を上げたい企業。開発10-20%・テスト30%の改善実績が武器',1,1,'service','service_lp',true,
     '既存のバイブコーディングLPと接続。SEO戦略をここで統合する'),
    ('ツール別研修','AIエージェント研修｜業務で使える自律型AIの活用法','AIエージェント 研修',
     '2026年の主戦場。開発は既にプランがあるが研修が抜けていた',1,1,'service','service_lp',false,null),
    ('ツール別研修','プロンプトエンジニアリング研修（法人向け）','プロンプトエンジニアリング 研修',
     '研修クラスタの定番。丸ごと欠落していた',2,2,'service','service_lp',false,null),
    ('法人向け生成AI研修','生成AI研修の導入事例・実績｜累計2,000名超の研修から','生成AI研修 導入事例',
     '実績で選びたい比較検討中の人事。実績企業・受講人数・満足度・前後の変化を明記',2,1,'case','article',false,null),
    ('対象者・部門別研修','生成AI社内推進リーダー・社内講師の育成','生成AI 社内講師 育成',
     '初心者研修より、成果を出し組織へ展開できる人材育成の方が差別化しやすい',1,2,'service','service_lp',false,null),
    ('対象者・部門別研修','情シス向け生成AI研修｜全社展開を支える','情シス 生成AI研修',
     '全社展開の要である情シス部門',1,3,'service','article',false,null),
    ('業界別AI活用','保険業界の生成AI活用と研修','保険会社 生成AI 活用',
     'ターゲット業界のはずが金融は銀行のみだった。保険を追加',2,2,'case','article',false,null),
    ('業界別AI活用','化学メーカーの生成AI活用と研修','化学メーカー AI 活用',
     'ターゲット業界。専門性で差別化',2,3,'case','article',false,null),
    ('営業AX','営業AI研修・営業部門への生成AI導入支援','営業AI研修',
     '営業特化の研修・導入支援。CRMを自社開発した実績が一次情報',1,1,'service','service_lp',false,null),
    ('営業AX','提案書・営業資料をAIで作る｜提案作成10倍速の実務','提案書 AI 作成',
     '展示会セミナー「提案作成が10倍速」の訴求とそのまま接続',2,2,'cluster','article',false,null),
    ('AI開発・自動化','生成AI開発会社｜RAG・Dify・AIエージェントのPoC・業務実装','生成AI開発 会社',
     '開発LPのピラー。既存の事例ページは事例色が強く商用検索には別途サービスページが要る',3,2,'pillar','service_lp',false,null),
    ('AI開発・自動化','社内チャットボット・FAQ AIの開発','社内チャットボット 開発',
     '社内ナレッジ活用の開発需要',3,3,'service','article',false,null),
    ('AIガバナンス','AIガバナンス研修・ガイドライン策定支援','AIガバナンス 研修',
     'ルール策定を任された担当。研修と策定支援の両方で受ける',1,2,'service','service_lp',false,null)
  ) as v(cluster, title, main_kw, angle, diff, pri, role, ptype, existing, note)
  on conflict (site_id, main_keyword) do nothing;

  -- 内製化系はリーダー育成プランへ（社内で回せる人を作る、という同一意図）
  update seo_keywords set article_plan_id=(select id from seo_article_plans where site_id=v_site and main_keyword='生成AI 社内講師 育成')
  where site_id=v_site and query in ('生成AI 研修 内製化','社内 AI研修 やり方','生成AI 勉強会 社内','生成AI 内製化 支援');

  -- ---- 8) 新規KW投入（メインKW含む・対策プランに紐付け） ----
  insert into seo_keywords (tenant_id, site_id, cluster_id, article_plan_id, query, intent_layer, search_volume, difficulty, priority, hypothesis, added_reason)
  select v_tenant, v_site, p.cluster_id, p.id, v.query, p.intent_layer, v.volume, v.diff, p.priority,
    '対策ページ「'||p.title||'」で取る', 'feedback_2026_07'
  from (values
    -- 総合LP: 提供形式・リテラシー・指名
    ('生成AI研修','生成AI研修 オンライン',150,3),('生成AI研修','生成AI研修 講師派遣',100,2),
    ('生成AI研修','生成AI研修 eラーニング',100,3),('生成AI研修','生成AI研修 カスタマイズ',50,2),
    ('生成AI研修','生成AI研修 1日',80,2),('生成AI研修','生成AI研修 全社員',50,2),
    ('生成AI研修','AIリテラシー研修 法人',150,2),('生成AI研修','AI活用研修 法人',100,2),
    ('生成AI研修','カトルセ 研修',30,1),
    -- 助成金
    ('AI研修 助成金','AI研修 助成金',400,2),('AI研修 助成金','生成AI研修 助成金',200,2),
    ('AI研修 助成金','人材開発支援助成金 生成AI',150,2),('AI研修 助成金','リスキリング 助成金 AI',200,2),
    ('AI研修 助成金','DX研修 助成金',100,2),
    -- Claude / バイブコーディング
    ('Claude 研修','Claude 研修',200,1),('Claude 研修','Claude Code 研修',150,1),
    ('Claude 研修','Claude 法人 導入',100,1),('Claude 研修','Claude 研修 法人',80,1),
    ('バイブコーディング 研修','バイブコーディング 研修',150,1),('バイブコーディング 研修','AI駆動開発 研修',100,1),
    ('バイブコーディング 研修','バイブコーディング 企業',80,1),('バイブコーディング 研修','バイブコーディング スクール',100,1),
    -- AIエージェント研修 / プロンプト研修
    ('AIエージェント 研修','AIエージェント 研修',200,1),('AIエージェント 研修','AIエージェント 活用 企業',300,2),
    ('AIエージェント 研修','AIエージェント 研修 法人',50,1),
    ('プロンプトエンジニアリング 研修','プロンプトエンジニアリング 研修',300,2),
    ('プロンプトエンジニアリング 研修','プロンプト 研修 法人',100,2),
    ('プロンプトエンジニアリング 研修','プロンプト 社内教育',80,2),
    -- 導入事例・実績
    ('生成AI研修 導入事例','生成AI研修 導入事例',200,3),('生成AI研修 導入事例','AI研修 導入事例',150,3),
    ('生成AI研修 導入事例','生成AI研修 実績',100,2),('生成AI研修 導入事例','生成AI研修 中小企業',150,3),
    ('生成AI研修 導入事例','生成AI研修 大企業',100,3),
    -- 推進人材・部門別
    ('生成AI 社内講師 育成','生成AI 社内講師 育成',80,1),('生成AI 社内講師 育成','生成AIリーダー研修',80,1),
    ('生成AI 社内講師 育成','DX推進リーダー研修',200,3),('生成AI 社内講師 育成','生成AI推進者 研修',50,1),
    ('情シス 生成AI研修','情シス 生成AI研修',80,1),('情シス 生成AI研修','人事部門 生成AI研修',50,1),
    -- 業界
    ('保険会社 生成AI 活用','保険会社 生成AI 活用',200,2),('保険会社 生成AI 活用','保険業界 AI 活用',100,2),
    ('化学メーカー AI 活用','化学メーカー AI 活用',100,2),('化学メーカー AI 活用','化学業界 生成AI',80,2),
    -- 営業AX
    ('営業AI研修','営業AI研修',100,1),('営業AI研修','営業AI導入支援',80,1),
    ('営業AI研修','営業部門 生成AI研修',50,1),('営業AI研修','営業AIコンサル',50,1),
    ('提案書 AI 作成','提案書 AI 作成',400,2),('提案書 AI 作成','営業資料 生成AI',200,2),
    ('提案書 AI 作成','営業メール AI',200,2),('提案書 AI 作成','商談準備 AI',80,1),
    ('営業DX 支援 会社','CRM AI連携',150,2),('営業DX 支援 会社','商談議事録 自動化',100,2),
    ('営業DX 支援 会社','営業活動 自動化 AI',100,2),
    -- AI顧問・導入定着（言葉が未定着なAI顧問に依存しない併用語）
    ('AI顧問','外部AI推進室',50,1),('AI顧問','AI活用伴走支援',80,1),
    ('生成AI 導入支援','生成AI定着支援',100,1),('生成AI 導入支援','生成AI 活用支援',150,2),
    ('生成AI 導入支援','AI推進支援',80,2),('生成AI 導入支援','生成AI PoC 支援',100,2),
    ('生成AI 導入支援','AIロードマップ 策定',100,2),('生成AI 導入支援','AI導入コンサル 中小企業',100,2),
    ('生成AIコンサルティング 会社','AI戦略コンサル',150,3),
    -- AI開発
    ('生成AI開発 会社','生成AI開発 会社',300,3),('生成AI開発 会社','AIシステム開発 会社',300,4),
    ('生成AI開発 会社','AI業務自動化 会社',100,3),('生成AI開発 会社','生成AI システム 費用',100,2),
    ('社内チャットボット 開発','社内チャットボット 開発',300,3),('社内チャットボット 開発','社内FAQ AI',200,2),
    ('社内チャットボット 開発','社内ナレッジ検索 AI',150,2),
    ('RAG 開発 会社','RAG 導入支援',100,2),('RAG 開発 会社','社内RAG 構築',100,2),
    ('Dify 開発 会社','Dify 保守 運用',50,1),
    -- ガバナンス
    ('AIガバナンス 研修','AIガバナンス 研修',80,1),('AIガバナンス 研修','生成AI ガイドライン 策定支援',80,1),
    ('AIガバナンス 研修','AIガイドライン 策定',100,2)
  ) as v(main_kw, query, volume, diff)
  join seo_article_plans p on p.site_id=v_site and p.main_keyword=v.main_kw
  on conflict (site_id, query) do nothing;

  -- 旧プランでメインKWがKW台帳に無かったものを補完（管理職・業種別など）
  insert into seo_keywords (tenant_id, site_id, cluster_id, article_plan_id, query, intent_layer, search_volume, difficulty, priority, hypothesis, added_reason)
  select v_tenant, v_site, p.cluster_id, p.id, p.main_keyword, p.intent_layer,
    v.volume, p.difficulty, p.priority, '対策ページ「'||p.title||'」のメインKW', 'feedback_2026_07'
  from (values
    ('生成AI研修 管理職',150),('経営層 AI研修',100),('生成AI研修 新入社員',100),
    ('生成AI研修 製造業',200),('生成AI研修 金融',80),('生成AI 建設業 活用',150),
    ('自治体 生成AI 研修',150),('Gemini 研修 法人',80)
  ) as v(main_kw, volume)
  join seo_article_plans p on p.site_id=v_site and p.main_keyword=v.main_kw
  on conflict (site_id, query) do nothing;

  -- ---- 9) KWのクラスタを対策プランに同期（分類のズレを一掃） ----
  update seo_keywords k set cluster_id=p.cluster_id
  from seo_article_plans p
  where k.site_id=v_site and k.article_plan_id=p.id and k.cluster_id is distinct from p.cluster_id;

  -- ---- 10) 目標順位の二段階化（難易度から機械的に設定） ----
  -- 「おすすめ」は実績で選びたい比較検討意図 → 導入事例ページで受ける
  update seo_keywords k set article_plan_id=p.id, cluster_id=p.cluster_id
  from seo_article_plans p
  where p.site_id=v_site and p.main_keyword='生成AI研修 導入事例' and k.site_id=v_site
    and k.query='生成AI 研修 おすすめ';

  update seo_keywords set
    target_position_6m  = case coalesce(difficulty,3) when 1 then 10 when 2 then 10 when 3 then 20 else 30 end,
    target_position_12m = case coalesce(difficulty,3) when 1 then 3  when 2 then 5  when 3 then 10 else 10 end
  where site_id=v_site;
  update seo_keywords set target_position = target_position_12m where site_id=v_site;
end $$;

-- ---- RPC更新: 対策ページ・二段階目標を返す ----
drop function if exists public.seo_keyword_gap(uuid);
drop function if exists public.seo_keyword_rankings(uuid, int);

create function public.seo_keyword_rankings(p_site uuid, p_weeks int default 8)
returns table (
  keyword_id uuid, query text, intent_layer smallint, cluster_name text,
  search_volume int, target_position_6m int, target_position_12m int, priority int,
  plan_title text, planned_url text, is_existing_page boolean,
  current_position numeric, prev_position numeric, delta numeric,
  impressions bigint, clicks bigint, ranking_page text,
  page_mismatch boolean, gap_status text
)
language sql stable security invoker set search_path = public as $$
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
    end
  from seo_keywords k
  left join seo_clusters c on c.id = k.cluster_id
  left join seo_article_plans ap on ap.id = k.article_plan_id
  left join cur on cur.query = k.query
  left join prev on prev.query = k.query
  where k.site_id = p_site and k.status = 'active' and k.is_target
  order by k.intent_layer nulls last, k.priority, k.search_volume desc nulls last;
$$;

create function public.seo_keyword_gap(p_site uuid)
returns table (
  intent_layer smallint, gap_status text, keywords int,
  total_volume bigint, total_impressions bigint, total_clicks bigint
)
language sql stable security invoker set search_path = public as $$
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

drop function if exists public.seo_article_plan_progress(uuid);
create function public.seo_article_plan_progress(p_site uuid)
returns table (
  plan_id uuid, title text, main_keyword text, intent_layer smallint,
  cluster_name text, difficulty smallint, priority int, page_role text,
  page_type text, planned_url text, is_existing_page boolean,
  status text, published_url text,
  keyword_count int, total_volume bigint, ranked_top10 int, ranked_any int,
  impressions bigint, clicks bigint
)
language sql stable security invoker set search_path = public as $$
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

comment on function public.seo_keyword_rankings is '狙ったKW×週次順位×対策ページ×二段階目標。1検索意図=1ページの設計を可視化する';
