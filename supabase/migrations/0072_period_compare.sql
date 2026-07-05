-- C-6 期間比較レポート: 主要指標(リード/アポ/受注件数/受注額)の月次24ヶ月分。
-- 前月比・前年同月比の計算はアプリ側で行う。
create or replace function public.period_compare()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  result jsonb;
begin
  with months as (
    select generate_series(
      date_trunc('month', current_date) - interval '23 months',
      date_trunc('month', current_date),
      interval '1 month'
    )::date as m
  ),
  ld as (
    select date_trunc('month', acquired_at)::date as m, count(*)::int as n
    from leads
    where tenant_id = any(v) and deleted_at is null and acquired_at is not null
    group by 1
  ),
  ap as (
    select date_trunc('month', first_meeting_date)::date as m, count(*)::int as n
    from opportunities
    where tenant_id = any(v) and deleted_at is null and first_meeting_date is not null
    group by 1
  ),
  wn as (
    select date_trunc('month', expected_close_date)::date as m,
      count(*)::int as n, coalesce(sum(amount), 0) as amount
    from opportunities
    where tenant_id = any(v) and deleted_at is null and status = 'won' and expected_close_date is not null
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(months.m, 'YYYY-MM'),
    'leads', coalesce(ld.n, 0),
    'appts', coalesce(ap.n, 0),
    'won_count', coalesce(wn.n, 0),
    'won_amount', coalesce(wn.amount, 0)
  ) order by months.m), '[]'::jsonb)
  into result
  from months
  left join ld on ld.m = months.m
  left join ap on ap.m = months.m
  left join wn on wn.m = months.m;
  return coalesce(result, '[]'::jsonb);
end $$;

revoke execute on function public.period_compare() from public, anon;
grant execute on function public.period_compare() to authenticated;
