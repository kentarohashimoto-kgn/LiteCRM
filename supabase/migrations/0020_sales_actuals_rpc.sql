-- 営業KPI実績(リード/アポ/成約/売上/粗利)を期間指定で1往復集計。RLS準拠。
create or replace function sales_actuals(p_start date, p_end date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'lead', (select count(*) from leads where acquired_at >= p_start and acquired_at <= p_end),
    'appointment', (select count(*) from opportunities where first_meeting_date is not null and first_meeting_date >= p_start and first_meeting_date <= p_end),
    'deal', (select count(*) from opportunities where status = 'won' and expected_close_date >= p_start and expected_close_date <= p_end),
    'revenue', (select coalesce(sum(amount), 0) from opportunities where status = 'won' and expected_close_date >= p_start and expected_close_date <= p_end),
    'gross_profit', (select coalesce(sum(gross_profit), 0) from opportunities where status = 'won' and expected_close_date >= p_start and expected_close_date <= p_end)
  )
$$;
