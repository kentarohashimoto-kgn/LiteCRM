-- =====================================================================
-- 0175: メモ欄のヒアリング内容から課題・導入時期・予算を判定するルールを追加
--   展示会運用: ブースで聞いた内容をメモ欄に記入 → 取込直後からスコアに反映される。
--   ルールは text_includes(課題・メモ・タグの全文に含む)で、軸は max 集計のため
--   コード値(リード詳細/架電キューの個別入力)と共存し、高い方が採用される。
--   キーワードは /app/leads/scoring でいつでも調整可能。
-- =====================================================================

insert into public.lead_scoring_rules (tenant_id, axis, label, match_kind, match_value, points, sort_order, is_active)
select t.id, v.axis, v.label, v.match_kind, v.match_value, v.points, v.sort_order, v.is_active
from public.tenants t,
  (values
    -- 課題(メモ判定): 具体的な検討の言及=強、興味・課題の言及=中
    ('needs',  'メモ: 具体的に検討の言及', 'text_includes', '導入を検討|導入したい|見積|提案してほしい|提案希望|デモ希望|トライアル|PoC|比較検討', 25, 11, true),
    ('needs',  'メモ: 興味・課題の言及',   'text_includes', '興味|関心|課題|困って|効率化|自動化|検討|情報収集', 12, 12, true),
    -- 導入時期(メモ判定)
    ('timing', 'メモ: 今すぐ(〜3ヶ月)',    'text_includes', '今すぐ|至急|急ぎ|すぐに|今期中|1ヶ月|2ヶ月|3ヶ月|来月', 15, 11, true),
    ('timing', 'メモ: 半年以内・年内',     'text_includes', '半年|6ヶ月|年内|下期|上期|今年度', 10, 12, true),
    -- 予算(メモ判定)
    ('budget', 'メモ: 予算ありの言及',     'text_includes', '予算あり|予算は確保|予算確保|予算内', 20, 11, true),
    ('budget', 'メモ: 予算検討・稟議中',   'text_includes', '予算を検討|予算検討|稟議|来期予算|予算申請', 10, 12, true)
  ) as v(axis, label, match_kind, match_value, points, sort_order, is_active)
where t.is_demo = false
  and exists (select 1 from public.lead_scoring_axes a where a.tenant_id = t.id and a.axis = v.axis)
  and not exists (select 1 from public.lead_scoring_rules r where r.tenant_id = t.id and r.label = v.label);
