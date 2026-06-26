-- 施策ROI集計RPC。SECURITY DEFINER + 明示テナント + materialized(seminar_followupの教訓)。
-- 期間 [p_start, p_end) ; リードは acquired_at、受注は expected_close_date で期間判定。openは現在スナップ。
-- ロールバック: drop function channel_roi(date,date);
create or replace function public.channel_roi(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tenants uuid[];
  v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants, 1) is null then
    return '[]'::jsonb;
  end if;

  with ch as materialized (
    select id, name, category, kind, priority_flag, committed_metric, committed_qty, target_level, sort_order
    from marketing_channels where tenant_id = any(v_tenants)
  ),
  cost as materialized (
    select channel_id, sum(fixed_cost + variable_cost) as c, sum(coalesce(result_qty, 0)) as rq
    from channel_costs
    where tenant_id = any(v_tenants) and month >= p_start and month < p_end
    group by channel_id
  ),
  ld as materialized (
    select marketing_channel_id as mch,
      count(*) as leads,
      count(*) filter (where funnel_stage = 'appointment' or disposition = 'appointment') as appts
    from leads
    where tenant_id = any(v_tenants) and marketing_channel_id is not null
      and acquired_at >= p_start and acquired_at < p_end
    group by marketing_channel_id
  ),
  op as materialized (
    select marketing_channel_id as mch,
      count(*) filter (where status = 'won' and expected_close_date >= p_start and expected_close_date < p_end) as deals,
      coalesce(sum(amount) filter (where status = 'won' and expected_close_date >= p_start and expected_close_date < p_end), 0) as revenue,
      coalesce(sum(coalesce(gross_profit, 0)) filter (where status = 'won' and expected_close_date >= p_start and expected_close_date < p_end), 0) as gp,
      count(*) filter (where status = 'open') as open_deals,
      coalesce(sum(amount) filter (where status = 'open'), 0) as open_amount
    from opportunities
    where tenant_id = any(v_tenants) and marketing_channel_id is not null
    group by marketing_channel_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ch.id, 'name', ch.name, 'category', ch.category, 'kind', ch.kind,
    'priority', ch.priority_flag, 'committed_metric', ch.committed_metric, 'committed_qty', ch.committed_qty,
    'target_level', ch.target_level,
    'cost', coalesce(cost.c, 0), 'result_qty', coalesce(cost.rq, 0),
    'leads', coalesce(ld.leads, 0), 'appts', coalesce(ld.appts, 0),
    'deals', coalesce(op.deals, 0), 'revenue', coalesce(op.revenue, 0), 'gross_profit', coalesce(op.gp, 0),
    'open_deals', coalesce(op.open_deals, 0), 'open_amount', coalesce(op.open_amount, 0)
  ) order by coalesce(op.revenue, 0) desc, ch.sort_order), '[]'::jsonb)
  into v_result
  from ch
  left join cost on cost.channel_id = ch.id
  left join ld on ld.mch = ch.id
  left join op on op.mch = ch.id;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;
