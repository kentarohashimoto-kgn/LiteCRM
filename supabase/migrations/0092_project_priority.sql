-- =====================================================================
-- 案件管理: 重要度(priority)を計画に付与。一覧の重み付け表示・ソートに使う。
-- =====================================================================
alter table public.project_plans add column if not exists priority text not null default 'middle'; -- high/middle/low
