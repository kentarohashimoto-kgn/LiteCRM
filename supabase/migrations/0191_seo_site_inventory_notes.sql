-- 0191: HP担当（ClaudeDesign）提供の全ページ一覧を台帳に反映（2026-07-30）
--
-- /st/ 配下の全101ページ（sitemap.xml 35→101URL化済み）のZIP提供を受け、
-- Search Consoleに未表示だったページも含めて突合した結果を反映する。
--
-- 判明事項:
--  - training.html は noindex + canonical→training-lp.html 設定済み（カニバリ懸念なし）
--  - バイブコーディング専用LPは /st/ に存在しない（knowledge-vibe-coding.html が唯一）
--  - prompt-campaign.html は「プロンプト100選」リードマグネット（研修LPとは別物・併存でOK）
--  - training-10h/2h/aidx/dept/dify はコース詳細ページ群（総合LPの子ページ）
--  - 助成金シミュレーター・策定キットWP・ロードマップWP等、強力な内部リンク資産が多数

do $$
declare v_site uuid;
begin
  select id into v_site
  from seo_sites where is_primary and tenant_id='00000000-0000-0000-0000-000000000001' limit 1;
  if v_site is null then return; end if;

  -- 総合LP: 子ページ（コース詳細）と支援記事群をハブとして束ねる
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      'コース詳細子ページ: /st/training-2h.html /st/training-10h.html /st/training-aidx.html(14h) /st/training-dept.html(部門別) /st/training-dify.html',
      '支援記事: knowledge-ai-training-selection(選び方) knowledge-ai-training-90days(90日定着) knowledge-group-training(集合型優位) knowledge-compare(ツール比較)',
      'training.html は noindex+canonical→training-lp.html 済みでカニバリ懸念なし')
  where site_id=v_site and main_keyword='生成AI研修';

  -- 助成金: シミュレーターが最強のCTA資産
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      'CTA資産: /st/training-subsidy-simulator.html(助成金シミュレーター)。記事→シミュレーター→問合せの動線を作る')
  where site_id=v_site and main_keyword='AI研修 助成金';

  -- 導入・定着ピラー: ロードマップ記事+WP+90日定着記事が既にある
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-ai-roadmap.html(導入5ステップ) /st/knowledge-ai-training-90days.html(90日定着) WP: /st/wp-ai-roadmap.html(90日プラン)')
  where site_id=v_site and main_keyword='生成AI 導入支援';

  -- AI顧問: CAIO記事2本が「CAIO 外部」語の受け皿資産
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-caio.html /st/knowledge-caio-2026.html(CAIO語の受け皿) /st/knowledge-microsoft-frontier.html(定着の潮流)')
  where site_id=v_site and main_keyword='AI顧問';

  -- ガバナンス策定支援: 策定キットWPをCTAに
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      'CTA資産: /st/wp-ai-guideline.html(AI活用ガイドライン策定キット)')
  where site_id=v_site and main_keyword='AIガバナンス 研修';

  -- RAG構築: 精度改善記事が既にある
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-rag-accuracy.html(RAG精度改善)')
  where site_id=v_site and main_keyword='RAG 開発 会社';

  -- AIエージェント開発: 概念記事2本が資産
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-human-in-the-loop.html /st/knowledge-digital-twin.html')
  where site_id=v_site and main_keyword='AIエージェント 開発 会社';

  -- 人材育成: LLMタレント記事が資産
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-llm-talent.html(AIタレントマネジメント)')
  where site_id=v_site and main_keyword='生成AI人材育成';

  -- プロンプト研修: キャンペーンLPとWPは併存でOK（リードマグネット）
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '確認済(2026-07-30): /st/prompt-campaign.html はプロンプト100選のリードマグネットで研修LPとは別物。併存し新LPから誘導。WP: /st/wp-prompts-30.html も資産')
  where site_id=v_site and main_keyword='プロンプトエンジニアリング 研修';

  -- バイブコーディング: 専用LPは存在しないことを確認（暫定→確定）
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '確認済(2026-07-30): /st/ に専用LPは無く knowledge-vibe-coding.html が唯一の対策ページ。LP新設するならURL決定後に差し替え')
  where site_id=v_site and main_keyword='バイブコーディング 研修';

  -- 経営層・管理職: 部門別・テーマ別実践研修ページが受け皿候補
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '受け皿候補: /st/training-dept.html(部門別・テーマ別 実践研修)。経営層・管理職向けの記載があるか確認して紐づけ判断')
  where site_id=v_site and main_keyword in ('経営層 AI研修','生成AI研修 管理職');

  -- 営業AI研修: 営業・マーケティングのサービスページが既にある
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '既存資産: /st/marketing.html(営業・マーケティング) /st/knowledge-seminar-title-ai.html(集客事例) /st/knowledge-ai-proposal-case.html(提案書事例)')
  where site_id=v_site and main_keyword='営業AI研修';

  -- 導入事例: 中小企業向け記事2本が「中小企業」語の資産
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '内部リンク元: /st/knowledge-sme-genai.html(105表示) /st/knowledge-sme-ai-start.html(中小企業語の受け皿)')
  where site_id=v_site and main_keyword='生成AI研修 導入事例';

  -- 建設業: 住宅業界記事が隣接資産
  update seo_article_plans set
    note=concat_ws(E'\n', nullif(note,''),
      '隣接資産: /st/knowledge-housing-genai.html(住宅業界。ハウスメーカー・工務店)')
  where site_id=v_site and main_keyword='生成AI 建設業 活用';
end $$;
