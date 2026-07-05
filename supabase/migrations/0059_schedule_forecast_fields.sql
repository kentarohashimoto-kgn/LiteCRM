-- 営業スケジュール分類に予想値を追加: 成約時期(年月)・受注確度・受注金額。
alter table public.sales_schedules
  add column if not exists expected_month date,        -- 成約時期(予想) YYYY-MM-01
  add column if not exists win_probability int,        -- 受注確度(予想) 0/20/40/60/80/100
  add column if not exists expected_amount numeric;    -- 受注金額(予測)
