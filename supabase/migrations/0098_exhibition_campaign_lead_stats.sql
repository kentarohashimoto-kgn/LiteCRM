-- =====================================================================
-- 展示会(campaign)のリード数・アポ数を「ライブ集計」する RPC。
--
--   背景: 展示会分析(/app/analytics/exhibitions)のリード/アポは、これまで
--         campaigns.actual_leads / appointments という静的フィールドを表示しており、
--         実際のリードデータ(leads)と連動していなかった（最新化されない）。
--
--   橋渡し: leads と campaigns は exhibition_events を介して紐づく。
--         leads.raw_event = exhibition_events.raw_event、
--         exhibition_events.campaign_id = campaigns.id
--         （leads.campaign_id は未設定運用のため使わない）。
--
--   本 RPC は campaign_id 別に leads件数・アポ件数(funnel_stage/disposition='appointment')
--   を返す。テナント境界は current_tenant_ids() で担保（他RPCと同方針）。
-- =====================================================================
create or replace function public.exhibition_campaign_lead_stats()
returns table(campaign_id uuid, leads bigint, appts bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select ee.campaign_id,
         count(l.*) as leads,
         count(l.*) filter (
           where l.funnel_stage = 'appointment' or l.disposition = 'appointment'
         ) as appts
  from exhibition_events ee
  join leads l
    on l.raw_event = ee.raw_event
   and l.tenant_id = ee.tenant_id
  where ee.tenant_id in (select current_tenant_ids())
    and ee.campaign_id is not null
  group by ee.campaign_id;
$$;
