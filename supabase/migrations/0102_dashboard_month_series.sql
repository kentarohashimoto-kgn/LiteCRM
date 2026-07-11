-- =====================================================================
-- ダッシュボード改善: 当月中心に前後6ヶ月（計13ヶ月）の月次系列を返すRPC。
--   - 月次推移の「前後6ヶ月」ビュー用に、実績(revenue)・見込み(wrevenue)・
--     アポ/成約・予測(commit/bestcase/weighted)を月別に返す。
--   - 売上/売上予測の「内訳」用に、各月の上位案件（受注/進行中）をjsonbで同梱。
--   集計規則は dashboard_metrics と厳密に一致させる:
--     rev_key   = expected_revenue_month || expected_close_date（予測の月キー）
--     close_key = expected_close_date || expected_revenue_month（受注実績の月キー）
--     weighted  = round(amount*probability/100)
-- =====================================================================
create or replace function public.dashboard_month_series(p_center date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  s date := (date_trunc('month', p_center) - interval '6 month')::date;
  e date := (date_trunc('month', p_center) + interval '6 month')::date;
  result jsonb;
begin
  if v is null or array_length(v,1) is null then return '[]'::jsonb; end if;

  with o as materialized (
    select o.id, o.name, o.account_id, o.status, o.forecast_category, o.amount, o.yomi,
      round(o.amount * o.probability / 100.0) as weighted,
      date_trunc('month', coalesce(o.expected_revenue_month, o.expected_close_date))::date as rev_key,
      date_trunc('month', coalesce(o.expected_close_date, o.expected_revenue_month))::date as close_key,
      date_trunc('month', o.first_meeting_date)::date as meet_key
    from opportunities o
    where o.tenant_id = any(v) and o.deleted_at is null
  ),
  months as (select gs.m::date as m from generate_series(s, e, interval '1 month') gs(m))
  select coalesce(jsonb_agg(jsonb_build_object(
    'month_key', to_char(m.m, 'YYYY-MM') || '-01',
    'ym', to_char(m.m, 'YYYY-MM'),
    'revenue',  (select coalesce(sum(o.amount),0) from o where o.status='won' and o.close_key = m.m),
    'deals',    (select count(*) from o where o.status='won' and o.close_key = m.m),
    'appts',    (select count(*) from o where o.meet_key = m.m),
    'wrevenue', (select coalesce(sum(case when o.status='won' then o.amount when o.status='open' then o.weighted else 0 end),0)
                 from o where o.rev_key = m.m and o.status in ('won','open')),
    'commit',   (select coalesce(sum(o.amount) filter (where o.status='open' and o.forecast_category='commit'),0)
                      + coalesce(sum(o.amount) filter (where o.status='won'),0) from o where o.rev_key = m.m),
    'bestcase', (select coalesce(sum(o.amount) filter (where o.status='open' and o.forecast_category in ('commit','best_case')),0)
                      + coalesce(sum(o.amount) filter (where o.status='won'),0) from o where o.rev_key = m.m),
    'weighted', (select coalesce(sum(o.weighted) filter (where o.status='open'),0)
                      + coalesce(sum(o.amount) filter (where o.status='won'),0) from o where o.rev_key = m.m),
    'won_deals', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'account', x.account, 'amount', x.amount) order by x.amount desc), '[]'::jsonb)
                  from (select o.name, (select a.name from accounts a where a.id=o.account_id) as account, o.amount
                        from o where o.status='won' and o.close_key = m.m order by o.amount desc limit 8) x),
    'open_deals', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'account', x.account, 'amount', x.amount,
                          'weighted', x.weighted, 'forecast_category', x.forecast_category, 'yomi', x.yomi) order by x.amount desc), '[]'::jsonb)
                  from (select o.name, (select a.name from accounts a where a.id=o.account_id) as account, o.amount, o.weighted, o.forecast_category, o.yomi
                        from o where o.status='open' and o.rev_key = m.m order by o.amount desc limit 8) x)
  ) order by m.m), '[]'::jsonb)
  into result from months m;
  return result;
end; $$;
