-- =====================================================================
-- Phase3: 施策 × 顧客レベル(規模帯) クロス集計
-- ロールバック: drop function channel_level_matrix(date,date); drop function size_band(text);
-- =====================================================================
create or replace function public.size_band(p text)
returns text language sql immutable as $function$
  select case
    when p is null or btrim(p) = '' then 'unknown'
    when p like '%1000名以上%' or p like '%1000人以上%' then 'enterprise'
    when p like '%100%1000%' then 'mid'
    when p ~ '[0-9]' then 'smb'
    else 'unknown'
  end;
$function$;

create or replace function public.channel_level_matrix(p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with ch as materialized (
    select id, name, category, sort_order from marketing_channels where tenant_id = any(v_tenants)
  ),
  ld as materialized (
    select marketing_channel_id mch, size_band(employee_size) band, count(*) leads
    from leads
    where tenant_id = any(v_tenants) and marketing_channel_id is not null
      and acquired_at >= p_start and acquired_at < p_end
    group by 1, 2
  ),
  wn as materialized (
    select o.marketing_channel_id mch, size_band(l.employee_size) band,
      count(*) deals, coalesce(sum(o.amount),0) revenue
    from opportunities o left join leads l on l.id = o.lead_id
    where o.tenant_id = any(v_tenants) and o.marketing_channel_id is not null and o.status='won'
      and o.expected_close_date >= p_start and o.expected_close_date < p_end
    group by 1, 2
  ),
  cells as (
    select coalesce(ld.mch, wn.mch) mch, coalesce(ld.band, wn.band) band,
      coalesce(ld.leads,0) leads, coalesce(wn.deals,0) deals, coalesce(wn.revenue,0) revenue
    from ld full join wn on ld.mch = wn.mch and ld.band = wn.band
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ch.id, 'name', ch.name, 'category', ch.category,
    'cells', coalesce((
      select jsonb_object_agg(c.band, jsonb_build_object('leads', c.leads, 'deals', c.deals, 'revenue', c.revenue))
      from cells c where c.mch = ch.id), '{}'::jsonb)
  ) order by ch.sort_order), '[]'::jsonb)
  into v_result from ch;
  return coalesce(v_result, '[]'::jsonb);
end; $function$;
