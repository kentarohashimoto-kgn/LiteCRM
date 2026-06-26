-- =====================================================================
-- Phase2: プロダクト収益(原価/工数/重点/派生) + サブスクMRR/解約
-- ロールバック:
--   drop function product_profitability(date,date);
--   drop function subscription_metrics(date,date);
--   alter table products drop column product_type, drop column unit_cost,
--     drop column delivery_hours, drop column priority_flag, drop column derived_from_product_id;
--   alter table billing_schedules drop column sub_status, drop column canceled_month, drop column cancel_reason;
-- =====================================================================
alter table products add column if not exists product_type text;
alter table products add column if not exists unit_cost numeric;
alter table products add column if not exists delivery_hours numeric;
alter table products add column if not exists priority_flag boolean default false;
alter table products add column if not exists derived_from_product_id uuid references products(id) on delete set null;

alter table billing_schedules add column if not exists sub_status text default 'active';
alter table billing_schedules add column if not exists canceled_month date;
alter table billing_schedules add column if not exists cancel_reason text;

create or replace function public.product_profitability(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with prod as materialized (
    select id, name, category, is_recurring, default_gross_profit_rate, product_type, unit_cost, priority_flag, status
    from products where tenant_id = any(v_tenants)
  ),
  won as materialized (
    select primary_product_id pid, count(*) deals,
      coalesce(sum(amount),0) revenue, coalesce(sum(coalesce(gross_profit,0)),0) gp
    from opportunities
    where tenant_id = any(v_tenants) and status='won' and primary_product_id is not null
      and expected_close_date >= p_start and expected_close_date < p_end
    group by primary_product_id
  ),
  openp as materialized (
    select primary_product_id pid, count(*) open_deals, coalesce(sum(amount),0) open_amount
    from opportunities
    where tenant_id = any(v_tenants) and status='open' and primary_product_id is not null
    group by primary_product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',prod.id,'name',prod.name,'category',prod.category,'is_recurring',prod.is_recurring,
    'product_type',prod.product_type,'unit_cost',prod.unit_cost,'priority',prod.priority_flag,
    'gp_rate',prod.default_gross_profit_rate,'status',prod.status,
    'deals',coalesce(won.deals,0),'revenue',coalesce(won.revenue,0),'gross_profit',coalesce(won.gp,0),
    'open_deals',coalesce(openp.open_deals,0),'open_amount',coalesce(openp.open_amount,0)
  ) order by coalesce(won.revenue,0) desc), '[]'::jsonb)
  into v_result
  from prod left join won on won.pid=prod.id left join openp on openp.pid=prod.id;
  return coalesce(v_result,'[]'::jsonb);
end; $function$;

create or replace function public.subscription_metrics(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with months as (
    select generate_series(p_start, (p_end - interval '1 month')::date, interval '1 month')::date m
  ),
  subs as materialized (
    select amount,
           date_trunc('month', recurring_start_month)::date as sm,
           date_trunc('month', recurring_end_month)::date as em,
           date_trunc('month', canceled_month)::date as cm
    from billing_schedules
    where tenant_id = any(v_tenants) and kind = 'recurring' and recurring_start_month is not null
  ),
  per as (
    select mo.m,
      coalesce(sum(s.amount) filter (where s.sm <= mo.m and (s.em is null or s.em >= mo.m) and (s.cm is null or s.cm > mo.m)),0) as mrr,
      coalesce(sum(s.amount) filter (where s.sm = mo.m),0) as new_mrr,
      coalesce(sum(s.amount) filter (where s.cm = mo.m),0) as churn_mrr,
      count(s.*) filter (where s.sm <= mo.m and (s.em is null or s.em >= mo.m) and (s.cm is null or s.cm > mo.m)) as active
    from months mo left join subs s on true
    group by mo.m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(per.m,'YYYY-MM'), 'mrr', per.mrr, 'new_mrr', per.new_mrr,
    'churn_mrr', per.churn_mrr, 'active', per.active) order by per.m), '[]'::jsonb)
  into v_result from per;
  return coalesce(v_result,'[]'::jsonb);
end; $function$;
