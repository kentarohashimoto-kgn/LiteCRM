-- 展示会別実績の「アポ」列を案件基準に修正。
-- 背景: アポ・商談は案件(opportunities.source_detail=展示会名)として登録されるが、
-- 元リード(leads)には反映されないケースがある(例: 一括登録した展示会)。従来の
-- exhibition_breakdown はアポをリードの決着状況(disposition/funnel_stage='appointment')
-- だけで数えていたため、案件は存在するのにアポ=0と表示されていた。
-- 対策: appts = GREATEST(その展示会由来の案件件数, リードのアポ決着数)。
--   このCRMでは「アポ獲得=案件が1件作成される」ため案件件数が正本。
--   稀にリード決着数の方が多い展示会は取りこぼさないよう GREATEST を採用(二重計上なし)。
CREATE OR REPLACE FUNCTION public.exhibition_breakdown(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with ev as materialized (
    select raw_event, ym, label, organizer, theme, cost from exhibition_events where tenant_id = any(v_tenants)
  ),
  ld as materialized (
    select l.raw_event, count(*) leads,
      count(*) filter (where l.funnel_stage='appointment' or l.disposition='appointment') appts,
      count(*) filter (where (l.rank in ('S','A') or size_band(l.employee_size)='enterprise'
         or coalesce(l.job_title,'') ~ '社長|代表|役員|取締役|本部長|部長|次長|CEO|COO|CxO|執行')) important,
      count(*) filter (where (l.rank in ('S','A') or size_band(l.employee_size)='enterprise'
         or coalesce(l.job_title,'') ~ '社長|代表|役員|取締役|本部長|部長|次長|CEO|COO|CxO|執行')
        and not (l.funnel_stage='appointment' or l.disposition='appointment')
        and coalesce(l.disposition,'') not in ('ng','excluded') and coalesce(l.funnel_stage,'') <> 'excluded') important_no_appt,
      count(*) filter (where not (l.funnel_stage='appointment' or l.disposition='appointment')
        and coalesce(l.disposition,'') not in ('ng','excluded') and coalesce(l.funnel_stage,'') <> 'excluded') nurture
    from leads l join marketing_channels m on m.id = l.marketing_channel_id
    where l.tenant_id = any(v_tenants) and m.category='展示会' and l.raw_event is not null and l.deleted_at is null
      and l.acquired_at >= p_start and l.acquired_at < p_end
    group by l.raw_event
  ),
  wn as materialized (
    select btrim(source_detail) re,
      count(*) appt_opps,  -- アポ獲得=案件件数(このCRMではアポ取得で案件が1件作成される)
      count(*) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end) deals,
      coalesce(sum(amount) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end),0) revenue,
      count(*) filter (where status='open') open_deals,
      coalesce(sum(amount) filter (where status='open'),0) open_amount
    from opportunities where tenant_id = any(v_tenants) and source_detail is not null and btrim(source_detail) <> '' and deleted_at is null
    group by btrim(source_detail)
  ),
  cst as materialized (select btrim(detail) re, sum(cost) cost from deal_detail_costs where tenant_id = any(v_tenants) group by btrim(detail)),
  keys as (select raw_event from ev union select raw_event from ld)
  select coalesce(jsonb_agg(jsonb_build_object(
    'raw_event', k.raw_event,
    'ym', coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}')),
    'label', coalesce(ev.label, regexp_replace(k.raw_event, '^[0-9]{6,8}_?', '')),
    'organizer', ev.organizer, 'theme', ev.theme,
    'cost', coalesce(cst.cost, ev.cost, 0),
    'leads', coalesce(ld.leads,0),
    'appts', greatest(coalesce(wn.appt_opps,0), coalesce(ld.appts,0)),
    'important', coalesce(ld.important,0), 'important_no_appt', coalesce(ld.important_no_appt,0), 'nurture', coalesce(ld.nurture,0),
    'deals', coalesce(wn.deals,0), 'revenue', coalesce(wn.revenue,0),
    'open_deals', coalesce(wn.open_deals,0), 'open_amount', coalesce(wn.open_amount,0)
  ) order by coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}'))), '[]'::jsonb)
  into v_result
  from keys k
  left join ev on ev.raw_event=k.raw_event
  left join ld on ld.raw_event=k.raw_event
  left join wn on wn.re=k.raw_event
  left join cst on cst.re=k.raw_event;
  return coalesce(v_result, '[]'::jsonb);
end; $function$;
