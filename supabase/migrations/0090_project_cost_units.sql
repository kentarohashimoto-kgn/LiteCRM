-- =====================================================================
-- 案件管理: 原価の単価種別(人月/時給)と工数記述(率/時間)に対応
--   予定・実績の双方を同じ考え方で入力できるようにする。
-- =====================================================================

-- 1人月あたりの標準労働時間(人月単価⇔時給、率⇔時間の換算に使用)。
alter table public.project_plans add column if not exists hours_per_month numeric not null default 160;

-- アサインの単価種別・工数記述。
alter table public.project_assignments add column if not exists rate_unit text not null default 'man_month';  -- man_month / hourly
alter table public.project_assignments add column if not exists effort_unit text not null default 'ratio';    -- ratio / hours

-- 月別セル: 時間モードの投下時間。
alter table public.project_cost_months add column if not exists hours numeric;
