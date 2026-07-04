-- 性能改善(item1): ダッシュボードの案件集計をサーバー(SQL)側で実施するRPC。
-- 従来は全案件(約1.3MB)を取得してJSで集計していたのを、集計結果の小さなJSONのみ返す。
-- 既存JSロジック(buildForecast/actualByMonth/repMetrics/productMetrics)と同じ規則を厳密に再現。
--   forecast: 月キー = expected_revenue_month || expected_close_date
--   won実績: 月キー = expected_close_date || expected_revenue_month（precedenceが逆）
--   weighted = round(amount*probability/100)、stale = open かつ 最終活動から7日以上
create or replace function public.dashboard_metrics(p_fy_start int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  cur_m date := date_trunc('month', current_date)::date;
  fy_start_date date := make_date(p_fy_start, 7, 1);
  result jsonb;
begin
  with o as materialized (
    select o.id, o.account_id, o.owner_user_id, o.primary_product_id, o.status, o.forecast_category,
      o.amount, o.next_action_date, o.last_activity_at, o.expected_close_date,
      round(o.amount * o.probability / 100.0) as weighted,
      date_trunc('month', coalesce(o.expected_revenue_month, o.expected_close_date))::date as rev_key,
      date_trunc('month', coalesce(o.expected_close_date, o.expected_revenue_month))::date as close_key,
      date_trunc('month', o.first_meeting_date)::date as meet_key
    from opportunities o
    where o.tenant_id = any(v)
  ),
  forecast6 as (
    select to_char(gs.m, 'YYYY-MM') || '-01' as month_key,
      to_char(gs.m, 'FMMM') || '月' as label,
      coalesce(sum(o.amount) filter (where o.status = 'open' and o.forecast_category = 'commit'), 0)
        + coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as commit,
      coalesce(sum(o.amount) filter (where o.status = 'open' and o.forecast_category in ('commit', 'best_case')), 0)
        + coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as bestcase,
      coalesce(sum(o.amount) filter (where o.status = 'open' and o.forecast_category = 'pipeline'), 0) as pipeline,
      coalesce(sum(o.weighted) filter (where o.status = 'open'), 0)
        + coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as weighted
    from generate_series(cur_m, cur_m + interval '5 month', interval '1 month') gs(m)
    left join o on o.rev_key = gs.m::date
    group by gs.m order by gs.m
  ),
  fiscal12 as (
    select to_char(gs.m, 'YYYY-MM') || '-01' as month_key,
      coalesce(sum(o.amount) filter (where o.status = 'won' and o.close_key = gs.m::date), 0) as revenue,
      coalesce(count(*) filter (where o.status = 'won' and o.close_key = gs.m::date), 0) as deals,
      coalesce(count(*) filter (where o.meet_key = gs.m::date), 0) as appts,
      coalesce(sum(case when o.status = 'won' and o.rev_key = gs.m::date then o.amount
                        when o.status = 'open' and o.rev_key = gs.m::date then o.weighted else 0 end), 0) as wrevenue
    from generate_series(fy_start_date, fy_start_date + interval '11 month', interval '1 month') gs(m)
    left join o on (o.close_key = gs.m::date or o.meet_key = gs.m::date or o.rev_key = gs.m::date)
    group by gs.m order by gs.m
  ),
  reps as (
    select o.owner_user_id, coalesce(p.display_name, p.email, '—') as name,
      coalesce(sum(o.weighted), 0) as weighted
    from o left join profiles p on p.id = o.owner_user_id
    where o.status = 'open'
    group by o.owner_user_id, p.display_name, p.email
  ),
  prods as (
    select o.primary_product_id as product_id, coalesce(pr.name, '—') as name,
      coalesce(sum(o.amount), 0) as open_amount
    from o join products pr on pr.id = o.primary_product_id
    where o.status = 'open' and o.primary_product_id is not null
    group by o.primary_product_id, pr.name
    order by open_amount desc
  ),
  no_next as (
    select o.id, coalesce(a.name, '—') as account_name, o.amount,
      coalesce(p.display_name, p.email, '—') as owner_name
    from o left join accounts a on a.id = o.account_id left join profiles p on p.id = o.owner_user_id
    where o.status = 'open' and o.next_action_date is null
    order by o.amount desc limit 8
  ),
  stale as (
    select o.id, coalesce(a.name, '—') as account_name, o.amount,
      coalesce(p.display_name, p.email, '—') as owner_name
    from o left join accounts a on a.id = o.account_id left join profiles p on p.id = o.owner_user_id
    where o.status = 'open' and o.last_activity_at is not null and o.last_activity_at < now() - interval '7 day'
    order by o.amount desc limit 8
  ),
  closing as (
    select o.id, coalesce(a.name, '—') as account_name, o.amount,
      coalesce(p.display_name, p.email, '—') as owner_name
    from o left join accounts a on a.id = o.account_id left join profiles p on p.id = o.owner_user_id
    where o.status = 'open' and date_trunc('month', o.expected_close_date) = cur_m
    order by o.amount desc limit 8
  )
  select jsonb_build_object(
    'forecast6', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from forecast6 f),
    'fiscal12', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from fiscal12 x),
    'reps', (select coalesce(jsonb_agg(to_jsonb(r) order by r.weighted desc), '[]') from reps r),
    'products', (select coalesce(jsonb_agg(to_jsonb(pp)), '[]') from prods pp),
    'no_next', (select coalesce(jsonb_agg(to_jsonb(n)), '[]') from no_next n),
    'stale', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from stale s),
    'closing', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from closing c)
  ) into result;
  return result;
end $$;

revoke execute on function public.dashboard_metrics(int) from public, anon;
grant execute on function public.dashboard_metrics(int) to authenticated;
