-- =====================================================================
-- 0195: 施策チケットに公開URLを記録する
--   運用実態は「指示書(プロンプト)を別AIに渡す → 公開したURLを持って戻る」。
--   戻ってきたURLを1操作で記録し、そのまま反映(applied_at)の起点にする。
--   ロールバック: alter table seo_actions drop column published_url;
-- =====================================================================
alter table public.seo_actions
  add column if not exists published_url text;

comment on column public.seo_actions.published_url is
  '実際に公開・更新したページのURL。反映記録と同時に登録し、効果検証の対象ページを確定させる';
