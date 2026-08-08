-- =====================================================================
-- 0210: 既存の改善提案を記事プランに紐付け直す（0209 の続き）
--   0209 で「同じ対象の承認待ちは1件」までは畳めたが、承認待ちの中身は
--   まだKW1語単位のまま。同じ記事プランのサブKWが別々の提案として
--   並んでいるので、これも1本に畳む。
--
--   例: 「生成AI研修」プラン（27語）に対して
--       「生成AI研修」「AI研修 企業」「生成AI 業務効率化」… が別提案
--       → 承認すると3本の別記事になる。1本に統合する。
--
--   残す行の選び方: プランのメインKWの提案を残す。
--   メインKWの提案が無いプランは全部 superseded にし、夜間バッチに
--   プラン単位の提案を作り直させる（中途半端な代表行を残さない）。
--
--   ロールバック: 業務データの状態遷移なので戻さない（履歴は superseded で残る）
-- =====================================================================

-- ---- 1) 台帳のKWから記事プランを引いて紐付ける ----
update public.seo_proposals p
   set article_plan_id = k.article_plan_id
  from public.seo_keywords k
 where p.article_plan_id is null
   and k.site_id = p.site_id
   and k.query = p.target_query
   and k.article_plan_id is not null;

-- ---- 2) 同じ記事プランの承認待ちを1件に畳む ----
with keep as (
  select distinct on (p.site_id, p.action_type, p.article_plan_id) p.id
    from public.seo_proposals p
    join public.seo_article_plans ap on ap.id = p.article_plan_id
   where p.status = 'pending_review'
     and p.article_plan_id is not null
   order by p.site_id, p.action_type, p.article_plan_id,
            -- メインKWの提案を最優先で残す
            (p.target_query = ap.main_keyword) desc,
            p.proposed_date desc, p.created_at desc
)
update public.seo_proposals p
   set status = 'superseded'
 where p.status = 'pending_review'
   and p.article_plan_id is not null
   and p.id not in (select id from keep);

-- ---- 3) メインKW以外が代表として残った行は捨てる ----
-- 中途半端な代表（サブKWの提案文のままプラン全体を指す）を残すと、
-- 指示書のメインKWが本来のメインKWとズレる。作り直させる。
update public.seo_proposals p
   set status = 'superseded'
  from public.seo_article_plans ap
 where ap.id = p.article_plan_id
   and p.status = 'pending_review'
   and p.target_query <> ap.main_keyword;
