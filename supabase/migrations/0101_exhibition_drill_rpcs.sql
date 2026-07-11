-- =====================================================================
-- 展示会ドリルダウン用RPC。
--   exhibition_opps          : 展示会由来の案件(商談)一覧（source_detail橋渡し）
--   exhibition_untouched_leads: 未商談の重要リード一覧（raw_event橋渡し）
-- どちらもテナント境界は current_tenant_ids() で担保。
-- =====================================================================

create or replace function public.exhibition_opps(p_campaign uuid)
returns table(
  id uuid, name text, account_name text, owner_user_id uuid, owner_name text,
  stage text, yomi text, amount numeric, probability int, status text,
  next_action_date date, next_action_text text, last_activity_at timestamptz,
  comment_count bigint
)
language sql stable security definer set search_path to 'public'
as $$
  with ev as (
    select raw_event from exhibition_events
    where campaign_id = p_campaign and tenant_id in (select current_tenant_ids())
  )
  select o.id, o.name, a.name, o.owner_user_id,
    coalesce(p.display_name, p.email, '—'),
    o.stage, o.yomi, o.amount, o.probability, o.status,
    o.next_action_date, o.next_action_text, o.last_activity_at,
    (select count(*) from opportunity_comments oc where oc.opportunity_id = o.id)
  from opportunities o
  join ev on btrim(o.source_detail) = ev.raw_event
  left join accounts a on a.id = o.account_id
  left join profiles p on p.id = o.owner_user_id
  where o.tenant_id in (select current_tenant_ids()) and o.deleted_at is null
  order by
    case o.status when 'open' then 0 when 'won' then 1 else 2 end,
    o.yomi nulls last,
    o.amount desc;
$$;

create or replace function public.exhibition_untouched_leads(p_campaign uuid, p_limit int default 100)
returns table(
  id uuid, company_name text, contact_name text, job_title text, department text,
  rank text, funnel_stage text, disposition text, nurture_status text,
  owner_user_id uuid, owner_name text, notes text, priority_score numeric,
  comment_count bigint, total_untouched bigint
)
language sql stable security definer set search_path to 'public'
as $$
  with ev as (
    select raw_event from exhibition_events
    where campaign_id = p_campaign and tenant_id in (select current_tenant_ids())
  ),
  base as (
    select l.*
    from leads l
    join ev on l.raw_event = ev.raw_event
    where l.tenant_id in (select current_tenant_ids())
      and l.deleted_at is null
      and l.converted_at is null and l.converted_opportunity_id is null
      and coalesce(l.disposition,'') not in ('ng','excluded','appointment')
      and coalesce(l.funnel_stage,'') <> 'appointment'
      and (l.rank in ('S','A')
           or coalesce(l.job_title,'') ~ '社長|代表|役員|取締役|本部長|部長|次長|CEO|COO|執行')
  )
  select b.id, b.company_name, b.contact_name, b.job_title, b.department,
    b.rank, b.funnel_stage, b.disposition, b.nurture_status,
    b.owner_user_id, coalesce(p.display_name, p.email, '—'), b.notes,
    coalesce(b.priority_score,0)::numeric,
    (select count(*) from lead_comments lc where lc.lead_id = b.id),
    (select count(*) from base)
  from base b
  left join profiles p on p.id = b.owner_user_id
  order by
    case b.rank when 'S' then 0 when 'A' then 1 when 'B' then 2 else 3 end,
    coalesce(b.priority_score,0) desc,
    b.acquired_at desc
  limit p_limit;
$$;
