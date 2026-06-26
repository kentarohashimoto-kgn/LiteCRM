-- 展示会分析の強化: 受注をcampaign経由で帰属 + 重要未アポ(掘り起こし)集計
-- 背景: won案件は lead_id を持たず campaign_id で紐付くため、exhibition_events に
--   campaign_id を持たせ、年月+名称マッチで紐付けて受注/受注額を帰属する。
-- ロールバック: alter table exhibition_events drop column campaign_id; (RPCは0031版へ)
alter table exhibition_events add column if not exists campaign_id uuid references campaigns(id) on delete set null;

update exhibition_events e
set campaign_id = c.id
from campaigns c
join lead_sources ls on ls.id = c.lead_source_id and ls.name = '展示会'
where e.tenant_id = c.tenant_id and e.campaign_id is null and c.event_date is not null
  and to_char(c.event_date, 'YYYYMM') = e.ym
  and (
    norm_company(c.name) ilike '%' || norm_company(coalesce(e.label, '')) || '%'
    or norm_company(coalesce(e.label, '')) ilike '%' || norm_company(c.name) || '%'
    or (select count(*) from campaigns c2 join lead_sources ls2 on ls2.id = c2.lead_source_id and ls2.name = '展示会'
        where c2.tenant_id = e.tenant_id and c2.event_date is not null
          and to_char(c2.event_date, 'YYYYMM') = e.ym) = 1
  );

create or replace function public.exhibition_breakdown(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with ev as materialized (
    select raw_event, ym, label, organizer, theme, cost, campaign_id from exhibition_events where tenant_id = any(v_tenants)
  ),
  ld as materialized (
    select l.raw_event,
      count(*) leads,
      count(*) filter (where l.funnel_stage='appointment' or l.disposition='appointment') appts,
      count(*) filter (where
        (l.rank in ('S','A') or size_band(l.employee_size)='enterprise'
         or coalesce(l.job_title,'') ~ '社長|代表|役員|取締役|本部長|部長|次長|CEO|COO|CxO|執行')) as important,
      count(*) filter (where
        (l.rank in ('S','A') or size_band(l.employee_size)='enterprise'
         or coalesce(l.job_title,'') ~ '社長|代表|役員|取締役|本部長|部長|次長|CEO|COO|CxO|執行')
        and not (l.funnel_stage='appointment' or l.disposition='appointment')
        and coalesce(l.disposition,'') not in ('ng','excluded') and coalesce(l.funnel_stage,'') <> 'excluded') as important_no_appt,
      count(*) filter (where
        not (l.funnel_stage='appointment' or l.disposition='appointment')
        and coalesce(l.disposition,'') not in ('ng','excluded') and coalesce(l.funnel_stage,'') <> 'excluded') as nurture
    from leads l join marketing_channels m on m.id = l.marketing_channel_id
    where l.tenant_id = any(v_tenants) and m.category='展示会' and l.raw_event is not null
      and l.acquired_at >= p_start and l.acquired_at < p_end
    group by l.raw_event
  ),
  wn as materialized (
    select e.raw_event, count(*) deals, coalesce(sum(o.amount),0) revenue
    from ev e
    join opportunities o on o.campaign_id = e.campaign_id and e.campaign_id is not null
    where o.tenant_id = any(v_tenants) and o.status='won'
      and o.expected_close_date >= p_start and o.expected_close_date < p_end
    group by e.raw_event
  ),
  keys as (select raw_event from ev union select raw_event from ld union select raw_event from wn)
  select coalesce(jsonb_agg(jsonb_build_object(
    'raw_event', k.raw_event,
    'ym', coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}')),
    'label', coalesce(ev.label, regexp_replace(k.raw_event, '^[0-9]{6,8}_?', '')),
    'organizer', ev.organizer, 'theme', ev.theme, 'cost', ev.cost,
    'leads', coalesce(ld.leads,0), 'appts', coalesce(ld.appts,0),
    'important', coalesce(ld.important,0), 'important_no_appt', coalesce(ld.important_no_appt,0), 'nurture', coalesce(ld.nurture,0),
    'deals', coalesce(wn.deals,0), 'revenue', coalesce(wn.revenue,0)
  ) order by coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}'))), '[]'::jsonb)
  into v_result
  from keys k left join ev on ev.raw_event=k.raw_event left join ld on ld.raw_event=k.raw_event left join wn on wn.raw_event=k.raw_event;
  return coalesce(v_result, '[]'::jsonb);
end; $function$;
