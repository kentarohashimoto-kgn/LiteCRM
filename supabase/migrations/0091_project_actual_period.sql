-- =====================================================================
-- 案件管理: 実績記入を「週次 / 月次 / 終了時」の3段階で選べるようにする
--   月次・終了時では予定をコピーして実績記入のベースにするため、
--   week_start を任意にし、期間種別と対象月を持たせる。
-- =====================================================================

alter table public.project_weekly_reports add column if not exists period_type text not null default 'weekly'; -- weekly / monthly / final
alter table public.project_weekly_reports add column if not exists period_month date;                          -- 月次の対象月(YYYY-MM-01)
alter table public.project_weekly_reports alter column week_start drop not null;                               -- 月次/終了時は週なし
