-- 展示会ラベルを YYYYMM_展示会名(リード側raw_event)に統一し、集客(リード)と受注(案件)を同一展示会に統合。
-- 案件の source_detail(展示会タイプ) を canonical へ正規化(取込時の正規化は lib/deal-import.canonicalExhibition と同じ対応表)。
with mp(src, canon) as (values
  ('20260610_AINATIVEEXPO','202606_AIEXPO幕張'),
  ('20250730_産業DX','202507_産業DX総合展（ビッグサイト）'),
  ('20260225_AI World春','202602_AIWorld'),
  ('20260513_ODEX','202605_ODEX'),
  ('20260324_AIDX営業マーケティング展','202603_AIDX営業マーケ'),
  ('20250917_生成AIワールド','202509_生成AIワールド（幕張）'),
  ('20260204_バックオフィスWorld','202602_バックオフィスW'),
  ('20251022_StartupJapanSummit（秋）','202510_StartupJapanSummit（秋）（幕張）'),
  ('ODEX2506','202506_ODEX（ビッグサイト）'),
  ('AIW2507','202507_AIworld（幕張）'),
  ('sansan2505','202505_StartupJAPAN'),
  ('RX2504','202504_StartupJapanSummit（春）'),
  ('20251030_ODEX大阪','202510_ODEX大阪'),
  ('20251217_StartupJapanEXPO大阪','20251217_Startup大阪'),
  ('20251126_ビジネスチャンス','20251126_ビジネスチャンスEXPO（ビッグサイト）'),
  ('DXPO','202508_DXPO（ビッグサイト）')
)
update opportunities o set source_detail = mp.canon from mp where btrim(o.source_detail) = mp.src;

-- exhibition_breakdown を集客＋受注＋原価の統合版に更新(本体は 0038 から拡張)
create or replace function public.exhibition_breakdown(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with ev as materialized (select raw_event, ym, label, organizer, theme, cost from exhibition_events where tenant_id = any(v_tenants)),
  ld as materialized (
    select l.raw_event, count(*) leads,
      count(*) filter (where l.funnel_stage='appointment' or l.disposition='appointment') appts,
      count(*) filter (where (l.rank in ('S','A') or size_band(l.employee_size)='enterprise' or coalesce(l.job_title,'') ~ '社長|代表|役員|取締役|本部長|部長|次長|CEO|COO|CxO|執行')) important,
      count(*) filter (where (l.rank in ('S','A') or size_band(l.employee_size)='enterprise' or coalesce(l.job_title,'') ~ '社長|代表|役員|取締役|本部長|部長|次長|CEO|COO|CxO|執行')
        and not (l.funnel_stage='appointment' or l.disposition='appointment') and coalesce(l.disposition,'') not in ('ng','excluded') and coalesce(l.funnel_stage,'') <> 'excluded') important_no_appt,
      count(*) filter (where not (l.funnel_stage='appointment' or l.disposition='appointment') and coalesce(l.disposition,'') not in ('ng','excluded') and coalesce(l.funnel_stage,'') <> 'excluded') nurture
    from leads l join marketing_channels m on m.id = l.marketing_channel_id
    where l.tenant_id = any(v_tenants) and m.category='展示会' and l.raw_event is not null and l.acquired_at >= p_start and l.acquired_at < p_end
    group by l.raw_event
  ),
  wn as materialized (
    select btrim(source_detail) re,
      count(*) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end) deals,
      coalesce(sum(amount) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end),0) revenue,
      count(*) filter (where status='open') open_deals, coalesce(sum(amount) filter (where status='open'),0) open_amount
    from opportunities where tenant_id = any(v_tenants) and source_detail is not null and btrim(source_detail) <> '' group by btrim(source_detail)
  ),
  cst as materialized (select btrim(detail) re, sum(cost) cost from deal_detail_costs where tenant_id = any(v_tenants) group by btrim(detail)),
  keys as (select raw_event from ev union select raw_event from ld)
  select coalesce(jsonb_agg(jsonb_build_object(
    'raw_event', k.raw_event, 'ym', coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}')),
    'label', coalesce(ev.label, regexp_replace(k.raw_event, '^[0-9]{6,8}_?', '')),
    'organizer', ev.organizer, 'theme', ev.theme, 'cost', coalesce(cst.cost, ev.cost, 0),
    'leads', coalesce(ld.leads,0), 'appts', coalesce(ld.appts,0),
    'important', coalesce(ld.important,0), 'important_no_appt', coalesce(ld.important_no_appt,0), 'nurture', coalesce(ld.nurture,0),
    'deals', coalesce(wn.deals,0), 'revenue', coalesce(wn.revenue,0), 'open_deals', coalesce(wn.open_deals,0), 'open_amount', coalesce(wn.open_amount,0)
  ) order by coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}'))), '[]'::jsonb)
  into v_result from keys k
  left join ev on ev.raw_event=k.raw_event left join ld on ld.raw_event=k.raw_event
  left join wn on wn.re=k.raw_event left join cst on cst.re=k.raw_event;
  return coalesce(v_result, '[]'::jsonb);
end; $function$;
