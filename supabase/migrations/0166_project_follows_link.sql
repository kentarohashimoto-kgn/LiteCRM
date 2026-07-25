-- =====================================================================
-- 原価管理: フェーズ紐づけ（前の案件の「続き」リンク）
--   同一エンゲージメントの連続案件（例: 検討企画フェーズ → 伴走支援フェーズ）を
--   カレンダーで1行にマージ表示するためのリンク。
--   project_plans.follows_opportunity_id = この計画の案件が「続き」である元案件。
--   RLS は project_plans の既存ポリシー(管理職のみ)がそのまま適用される。
-- =====================================================================

alter table public.project_plans
  add column if not exists follows_opportunity_id uuid
    references public.opportunities(id) on delete set null;

comment on column public.project_plans.follows_opportunity_id is
  'この案件が「続き」である元案件(前フェーズ)。カレンダーで同一行にマージ表示するためのリンク。';
