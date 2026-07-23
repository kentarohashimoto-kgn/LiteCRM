-- =====================================================================
-- 原価管理: 案件ごとの「責任者（対応チームのリーダー）」を指名する
--   アサイン(project_assignments: 外注/社員)の中から1名を選び、
--   その案件の責任者として明示する運用のためのカラム。
--   一覧・詳細で表示し、リーダー不在の案件に気づけるようにする。
--   RLS は project_plans の既存ポリシー(管理職のみ)がそのまま適用される。
-- =====================================================================

alter table public.project_plans
  add column if not exists lead_assignment_id uuid
    references public.project_assignments(id) on delete set null;

comment on column public.project_plans.lead_assignment_id is
  '対応チームの責任者(リーダー)として指名したアサイン。project_assignments.id を参照。アサイン削除時は NULL。';
