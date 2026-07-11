-- =====================================================================
-- 展示会(campaign)の実績を「ライブ集計」する統合RPC。
--
--   背景: 展示会分析の 成約/売上 は campaignMetrics が opportunities を
--         o.campaign_id で紐づけていたが、展示会案件は source_detail(=raw_event)
--         でのみ紐づく運用のため、常に 0 件・¥0 になっていた。
--         またアポ数はリードのファネル(appointment)から数えており、営業レントゲン等
--         他機能の「アポ=商談(案件)数」と整合しなかった。
--
--   本RPCは exhibition_events を橋渡しに、campaign_id 別で
--     - leads      : leads(raw_event一致)の件数
--     - opp_count  : 展示会由来の案件(商談)数  ← アポ数の正本(他機能と統一)
--     - won_count / won_amount : 受注案件数・受注金額
--     - open_count / open_weighted : 進行中件数・加重パイプライン(amount×確度)
--     - lost_count : 失注件数
--   を返す。テナント境界は current_tenant_ids() で担保。
-- =====================================================================
create or replace function public.exhibition_campaign_stats()
returns table(
  campaign_id uuid,
  leads bigint,
  opp_count bigint,
  won_count bigint,
  won_amount numeric,
  open_count bigint,
  lost_count bigint,
  open_weighted numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ev as (
    select distinct ee.campaign_id, ee.raw_event
    from exhibition_events ee
    where ee.campaign_id is not null
      and ee.tenant_id in (select current_tenant_ids())
  ),
  ld as (
    select ev.campaign_id, count(l.*) as leads
    from ev
    join leads l
      on l.raw_event = ev.raw_event
     and l.tenant_id in (select current_tenant_ids())
    group by ev.campaign_id
  ),
  op as (
    select ev.campaign_id,
      count(o.*) as opp_count,
      count(o.*) filter (where o.status = 'won') as won_count,
      coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as won_amount,
      count(o.*) filter (where o.status = 'open') as open_count,
      count(o.*) filter (where o.status = 'lost') as lost_count,
      coalesce(sum(round(o.amount * coalesce(o.probability, 0) / 100.0))
               filter (where o.status = 'open'), 0) as open_weighted
    from ev
    join opportunities o
      on btrim(o.source_detail) = ev.raw_event
     and o.tenant_id in (select current_tenant_ids())
     and o.deleted_at is null
    group by ev.campaign_id
  ),
  keys as (select distinct campaign_id from ev)
  select k.campaign_id,
    coalesce(ld.leads, 0),
    coalesce(op.opp_count, 0),
    coalesce(op.won_count, 0),
    coalesce(op.won_amount, 0),
    coalesce(op.open_count, 0),
    coalesce(op.lost_count, 0),
    coalesce(op.open_weighted, 0)
  from keys k
  left join ld on ld.campaign_id = k.campaign_id
  left join op on op.campaign_id = k.campaign_id;
$$;
