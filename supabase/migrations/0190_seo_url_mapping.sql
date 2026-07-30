-- 0190: 対策URLの実在ページ紐づけ（2026-07-30）
--
-- ユーザー依頼「https://catorce.jp/st/ 配下を検索してURLを表に追加・紐づけできますか？」への対応。
-- 直接クロールはネットワークポリシーで不可のため、Search Console実データ（seo_page_weekly）で
-- Googleが実際に検索結果に表示している /st/ 配下URLを特定し、記事プランへ紐づけた。
-- 表示回数が付いているURL = 実在してインデックスされているページ、という確度の高い根拠になる。
--
-- 1) 既存ページが特定できた13プラン: planned_url を設定（新規予定だったものは既存強化へ切替）
-- 2) 新規LP予定のプラン: 同テーマの既存記事を「内部リンク元資産」として note に記録
--    （新規LP公開時にどこからリンクを張るかが公開当日に分かる）

do $$
declare v_site uuid;
begin
  select id into v_site
  from seo_sites where is_primary and tenant_id='00000000-0000-0000-0000-000000000001' limit 1;
  if v_site is null then return; end if;

  -- ---- 1) 既存ページへの紐づけ（main_keyword はプランの一意キー） ----

  -- 総合LP。現「AI研修のご案内」ページ
  update seo_article_plans set planned_url='/st/training-lp.html', is_existing_page=true,
    note=concat_ws(E'\n', nullif(note,''), '内部リンク元: /st/knowledge-ai-training-guide.html(表示104)')
  where site_id=v_site and main_keyword='生成AI研修';

  -- 助成金ガイド（既存の解説記事を研修サービスと接続して強化）
  update seo_article_plans set planned_url='/st/knowledge-training-subsidy.html', is_existing_page=true
  where site_id=v_site and main_keyword='AI研修 助成金';

  -- Dify研修（研修ページが既にある）
  update seo_article_plans set planned_url='/st/training-dify.html', is_existing_page=true,
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-dify-guide.html(47) /st/knowledge-copilot-dify-chatgpt.html(156) /st/knowledge-dify-notebooklm.html(52)')
  where site_id=v_site and main_keyword='Dify 研修';

  -- AI顧問（サービスページが既にある。新規予定→既存強化へ切替）
  update seo_article_plans set planned_url='/st/ai-advisor.html', is_existing_page=true,
    note=concat_ws(E'\n', nullif(note,''), '内部リンク元: /st/knowledge-ai-advisor-guide.html(240)')
  where site_id=v_site and main_keyword='AI顧問';

  -- 導入・定着ピラー（既存の導入ガイド記事を土台に拡張）
  update seo_article_plans set planned_url='/st/knowledge-ai-introduction-guide.html', is_existing_page=true
  where site_id=v_site and main_keyword='生成AI 導入支援';

  -- ガイドライン記事（既存あり）
  update seo_article_plans set planned_url='/st/knowledge-genai-guideline.html', is_existing_page=true
  where site_id=v_site and main_keyword='生成AI ガイドライン 企業';

  -- 情シス向け研修記事（既存あり）
  update seo_article_plans set planned_url='/st/knowledge-itdept-training.html', is_existing_page=true,
    note=concat_ws(E'\n', nullif(note,''), '内部リンク元: /st/knowledge-itdept-genai.html(46)')
  where site_id=v_site and main_keyword='情シス 生成AI研修';

  -- 営業×生成AI（既存あり）
  update seo_article_plans set planned_url='/st/knowledge-sales-genai.html', is_existing_page=true
  where site_id=v_site and main_keyword='営業 生成AI 活用';

  -- 提案書AI（既存あり）
  update seo_article_plans set planned_url='/st/knowledge-ai-sales-proposal.html', is_existing_page=true
  where site_id=v_site and main_keyword='提案書 AI 作成';

  -- 社内チャットボット/FAQ AI（既存あり）
  update seo_article_plans set planned_url='/st/knowledge-faq-ai.html', is_existing_page=true
  where site_id=v_site and main_keyword='社内チャットボット 開発';

  -- 業務効率化事例（既存あり）
  update seo_article_plans set planned_url='/st/knowledge-genai-cases.html', is_existing_page=true
  where site_id=v_site and main_keyword='生成AI 業務効率化 事例';

  -- 議事録AI比較記事（既存あり。SaaS比較意図なので比較→選定支援へ誘導の役割）
  update seo_article_plans set planned_url='/st/knowledge-ai-meeting-tools.html', is_existing_page=true,
    note=concat_ws(E'\n', nullif(note,''), '関連: /st/local-meeting-ai.html(67) も議事録AI関連の既存ページ')
  where site_id=v_site and main_keyword='議事録AI 法人';

  -- バイブコーディング研修（既存記事あり。専用LPが別にあるならURLを差し替える）
  update seo_article_plans set planned_url='/st/knowledge-vibe-coding.html', is_existing_page=true,
    note=concat_ws(E'\n', nullif(note,''),
      '暫定紐づけ。専用LPが別URLならそちらへ差し替える。内部リンク元: /st/knowledge-ai-driven-dev.html(477)')
  where site_id=v_site and main_keyword='バイブコーディング 研修';

  -- ---- 2) 新規LP予定プランの内部リンク元資産を記録 ----

  -- Claude研修LP: Claude記事群が既に約9,600表示。公開当日にここからリンクを張る
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元(合計約9,600表示): /st/knowledge-claude-code-pricing.html(6,286) /st/knowledge-claude-code.html(2,274) /st/knowledge-claude-design.html(656) /st/knowledge-claude-security.html(244) /st/knowledge-claude-guide.html(112)')
  where site_id=v_site and main_keyword='Claude 研修';

  -- NotebookLM研修LP
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-notebooklm.html(1,052) /st/knowledge-dify-notebooklm.html(52)')
  where site_id=v_site and main_keyword='NotebookLM 研修';

  -- Copilot研修LP
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-copilot.html(814) /st/knowledge-github-copilot.html(39) /news/m365-copilot-training/(12)')
  where site_id=v_site and main_keyword='Copilot研修 法人';

  -- AIエージェント研修LP
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-agent.html(104) /st/knowledge-sales-ai-agent.html(63)')
  where site_id=v_site and main_keyword='AIエージェント 研修';

  -- 生成AI開発ピラーLP: 開発事例ページを実績セクションの素材に
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''), '既存資産: /st/development-cases.html(80) を実績・事例として接続')
  where site_id=v_site and main_keyword='生成AI開発 会社';

  -- プロンプト研修LP: 既存キャンペーンLPの扱いを確認
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''), '既存の /st/prompt-campaign.html(キャンペーンLP)との統合可否を確認')
  where site_id=v_site and main_keyword='プロンプトエンジニアリング 研修';
end $$;
