-- B-2 ゴミ箱(論理削除＋復元): leads / opportunities / accounts に deleted_at を追加。
-- 方針:
--   (1) 通常のPostgREST参照は RLS(select policy) で deleted_at is null を強制 → 既存クエリは無修正で除外される
--   (2) RLSをバイパスする security definer RPC は本ファイルで deleted_at フィルタを追加して再定義
--   (3) ゴミ箱の閲覧/復元/完全削除は専用RPC(trash_*)。30日超過の自動パージは trash_purge_expired()(service_roleのみ)
-- ロールバック: 各 alter policy を元に戻し、列を drop、関数を旧定義に戻す

-- ============================================================
-- (1) 列とインデックス
-- ============================================================
alter table public.leads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);
alter table public.opportunities
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);
alter table public.accounts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);

create index if not exists idx_leads_deleted on public.leads(tenant_id, deleted_at desc) where deleted_at is not null;
create index if not exists idx_opps_deleted on public.opportunities(tenant_id, deleted_at desc) where deleted_at is not null;
create index if not exists idx_accounts_deleted on public.accounts(tenant_id, deleted_at desc) where deleted_at is not null;

-- ============================================================
-- (2) RLS: select policy に deleted_at is null を追加
--     (update/delete policy は変更しない: 復元/パージは security definer RPC 経由)
-- ============================================================
alter policy leads_select on public.leads
  using (
    tenant_id in (select current_tenant_ids())
    and (can_view_all(tenant_id) or owner_user_id = auth.uid())
    and deleted_at is null
  );

alter policy opps_select on public.opportunities
  using (
    tenant_id in (select current_tenant_ids())
    and (can_view_all(tenant_id) or owner_user_id = auth.uid())
    and deleted_at is null
  );

alter policy accounts_select on public.accounts
  using (
    tenant_id in (select current_tenant_ids())
    and deleted_at is null
    and (
      can_view_all(tenant_id)
      or owner_user_id = auth.uid()
      or exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = auth.uid())
    )
  );

-- ============================================================
-- (3) security definer RPC の再定義(deleted_at フィルタ追加)
-- ============================================================

-- ---- opportunities_page (0053/0056ベース) ----
CREATE OR REPLACE FUNCTION public.opportunities_page(p_filter jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'expected_close_date'::text, p_asc boolean DEFAULT true, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  yomi text[] := case when jsonb_typeof(p_filter->'yomi') = 'array' and jsonb_array_length(p_filter->'yomi') > 0
                      then array(select jsonb_array_elements_text(p_filter->'yomi')) else null end;
  f_owner uuid := nullif(p_filter->>'owner', '')::uuid;
  f_product uuid := nullif(p_filter->>'product', '')::uuid;
  f_source uuid := nullif(p_filter->>'source', '')::uuid;
  f_campaign uuid := nullif(p_filter->>'campaign', '')::uuid;
  only_no_next boolean := coalesce((p_filter->>'only_no_next')::boolean, false);
  only_stale boolean := coalesce((p_filter->>'only_stale')::boolean, false);
  sort_col text := case p_sort
    when 'amount' then 'o.amount'
    when 'probability' then 'o.probability'
    when 'last_activity_at' then 'o.last_activity_at'
    else 'o.expected_close_date' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with f as (
      select o.id, o.name, a.name as account_name, o.yomi, o.owner_user_id,
        coalesce(p.display_name, p.email, '—') as owner_name, p.avatar_color as owner_color,
        o.primary_product_id, pr.name as product_name, o.campaign_id, c.name as campaign_name, o.campaign_estimated,
        o.lead_source_id, ls.name as source_name,
        o.amount, o.stage, o.probability, o.forecast_category, o.status, o.deal_phase,
        o.expected_close_date, o.expected_revenue_month, o.next_action_date, o.next_action_text, o.notes, o.last_activity_at,
        o.risk_level, o.first_meeting_date, o.appointment_at, o.created_at, o.updated_at,
        (select count(*) from meetings mt where mt.opportunity_id = o.id)::int as meeting_count,
        round(o.amount * o.probability / 100.0) as weighted,
        count(*) over() as total,
        sum(o.amount) over() as sum_amount,
        sum(round(o.amount * o.probability / 100.0)) over() as sum_weighted,
        row_number() over(order by %s %s nulls last) as rn
      from opportunities o
        left join accounts a on a.id = o.account_id
        left join profiles p on p.id = o.owner_user_id
        left join products pr on pr.id = o.primary_product_id
        left join campaigns c on c.id = o.campaign_id
        left join lead_sources ls on ls.id = o.lead_source_id
      where o.tenant_id = any($1)
        and o.deleted_at is null
        and ($2 is null or o.name ilike '%%' || $2 || '%%' or a.name ilike '%%' || $2 || '%%')
        and ($3 is null or o.yomi = any($3))
        and ($4 is null or o.owner_user_id = $4)
        and ($5 is null or o.primary_product_id = $5)
        and ($6 is null or o.lead_source_id = $6)
        and ($7 is null or o.campaign_id = $7)
        and (not $8 or (o.status = 'open' and o.next_action_date is null))
        and (not $9 or (o.status = 'open' and o.last_activity_at < now() - interval '7 day'))
      order by %s %s nulls last
      limit $10 offset $11
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(to_jsonb(f) - 'total' - 'sum_amount' - 'sum_weighted' - 'rn' order by f.rn), '[]'::jsonb),
      'total', coalesce(max(f.total), 0),
      'sum_amount', coalesce(max(f.sum_amount), 0),
      'sum_weighted', coalesce(max(f.sum_weighted), 0)
    ) from f
  $f$, sort_col, dir, sort_col, dir)
  into result
  using v, q, yomi, f_owner, f_product, f_source, f_campaign, only_no_next, only_stale, p_limit, p_offset;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'sum_amount', 0, 'sum_weighted', 0));
end $function$;

-- ---- accounts_page (0054ベース) ----
CREATE OR REPLACE FUNCTION public.accounts_page(p_filter jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'revenue'::text, p_asc boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  f_rank text := nullif(p_filter->>'rank', '');
  f_focus text := nullif(p_filter->>'focus', '');
  f_area text := nullif(p_filter->>'area', '');
  f_industry text := nullif(p_filter->>'industry', '');
  f_owner text := nullif(p_filter->>'owner', '');
  f_active text := nullif(p_filter->>'active', '');
  sort_expr text := case p_sort
    when 'openAmount' then 'open_amount'
    when 'oppCount' then 'opp_count'
    when 'name' then 'name'
    when 'rank' then 'rank_order'
    else 'lifetime_revenue' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with agg as (
      select a.id, a.name, a.industry, a.area, a.status, a.rank, a.focus, a.owner_user_id,
        coalesce(p.display_name, p.email, '—') as owner_name,
        coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as lifetime_revenue,
        coalesce(sum(o.amount) filter (where o.status = 'open'), 0) as open_amount,
        count(o.id) as opp_count,
        (count(o.id) filter (where o.status = 'open')) > 0 as is_active,
        case a.rank when 'S' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'dormant' then 4 else 9 end as rank_order
      from accounts a
        left join opportunities o on o.account_id = a.id and o.deleted_at is null
        left join profiles p on p.id = a.owner_user_id
      where a.tenant_id = any($1)
        and a.deleted_at is null
        and ($2 is null or a.name ilike '%%' || $2 || '%%')
        and ($3 is null or a.rank = $3)
        and ($4 is null or a.focus = $4)
        and ($5 is null or a.area = $5)
        and ($6 is null or a.industry = $6)
        and ($7 is null or ($7 = '__none' and a.owner_user_id is null) or a.owner_user_id::text = $7)
      group by a.id, p.display_name, p.email
    ),
    filt as (
      select *, count(*) over() as total, row_number() over(order by %s %s nulls last, name asc) as rn
      from agg
      where ($8 is null or ($8 = 'active' and is_active) or ($8 = 'inactive' and not is_active))
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(to_jsonb(filt) - 'total' - 'rn' - 'rank_order' order by rn) filter (where rn > $9 and rn <= $9 + $10), '[]'::jsonb),
      'total', coalesce(max(total), 0)
    ) from filt
  $f$, sort_expr, dir)
  into result
  using v, q, f_rank, f_focus, f_area, f_industry, f_owner, f_active, p_offset, p_limit;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0));
end $function$;

-- ---- global_search (0062ベース) ----
CREATE OR REPLACE FUNCTION public.global_search(p_q text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := trim(p_q);
  result jsonb;
begin
  if q = '' or q is null then
    return '[]'::jsonb;
  end if;
  with acc as (
    select 'account' as kind, a.id::text, a.name as title,
      coalesce(a.industry,'') || case when a.rank is not null then ' ・ ランク' || a.rank else '' end as sub
    from accounts a where a.tenant_id = any(v) and a.deleted_at is null and a.name ilike '%'||q||'%'
    order by a.name limit 8
  ),
  opp as (
    select 'opportunity' as kind, o.id::text, coalesce(a.name,'') || '｜' || o.name as title,
      coalesce(o.yomi,'') || case when o.amount > 0 then ' ・ ' || to_char(o.amount, 'FM999,999,999') || '円' else '' end as sub
    from opportunities o left join accounts a on a.id = o.account_id
    where o.tenant_id = any(v) and o.deleted_at is null and (o.name ilike '%'||q||'%' or a.name ilike '%'||q||'%')
    order by o.last_activity_at desc nulls last limit 8
  ),
  ld as (
    select 'lead' as kind, l.id::text, coalesce(l.company_name,'') || case when l.contact_name is not null then '｜' || l.contact_name else '' end as title,
      coalesce(l.raw_event,'') || case when l.rank is not null then ' ・ ' || l.rank else '' end as sub
    from leads l
    where l.tenant_id = any(v) and l.deleted_at is null and (l.company_name ilike '%'||q||'%' or l.contact_name ilike '%'||q||'%')
    order by l.priority_score desc nulls last limit 8
  )
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into result
  from (select * from acc union all select * from opp union all select * from ld) x;
  return result;
end $function$;

-- ---- dashboard_metrics (0052ベース) ----
CREATE OR REPLACE FUNCTION public.dashboard_metrics(p_fy_start integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  cur_m date := date_trunc('month', current_date)::date;
  fy_start_date date := make_date(p_fy_start, 7, 1);
  result jsonb;
begin
  with o as materialized (
    select o.id, o.account_id, o.owner_user_id, o.primary_product_id, o.status, o.forecast_category,
      o.amount, o.probability, o.stage, o.next_action_date, o.last_activity_at, o.expected_close_date,
      round(o.amount * o.probability / 100.0) as weighted,
      date_trunc('month', coalesce(o.expected_revenue_month, o.expected_close_date))::date as rev_key,
      date_trunc('month', coalesce(o.expected_close_date, o.expected_revenue_month))::date as close_key,
      date_trunc('month', o.first_meeting_date)::date as meet_key
    from opportunities o
    where o.tenant_id = any(v) and o.deleted_at is null
  ),
  forecast6 as (
    select to_char(gs.m, 'YYYY-MM') || '-01' as month_key, to_char(gs.m, 'FMMM') || '月' as label,
      coalesce(sum(o.amount) filter (where o.status = 'open' and o.forecast_category = 'commit'), 0)
        + coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as commit,
      coalesce(sum(o.amount) filter (where o.status = 'open' and o.forecast_category in ('commit', 'best_case')), 0)
        + coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as bestcase,
      coalesce(sum(o.amount) filter (where o.status = 'open' and o.forecast_category = 'pipeline'), 0) as pipeline,
      coalesce(sum(o.weighted) filter (where o.status = 'open'), 0)
        + coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as weighted
    from generate_series(cur_m, cur_m + interval '5 month', interval '1 month') gs(m)
    left join o on o.rev_key = gs.m::date group by gs.m order by gs.m
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
    select o.owner_user_id, coalesce(p.display_name, p.email, '—') as name, coalesce(sum(o.weighted), 0) as weighted
    from o left join profiles p on p.id = o.owner_user_id
    where o.status = 'open' group by o.owner_user_id, p.display_name, p.email
  ),
  prods as (
    select o.primary_product_id as product_id, coalesce(pr.name, '—') as name, coalesce(sum(o.amount), 0) as open_amount
    from o join products pr on pr.id = o.primary_product_id
    where o.status = 'open' and o.primary_product_id is not null group by o.primary_product_id, pr.name order by open_amount desc
  ),
  base_open as (
    select o.id, o.account_id, o.amount, o.probability, o.status, o.stage, o.forecast_category,
      o.next_action_date, o.last_activity_at, o.expected_close_date,
      o.owner_user_id, coalesce(a.name,'—') as account_name,
      coalesce(p.display_name, p.email, '—') as owner_name, p.avatar_color as owner_color
    from o left join accounts a on a.id=o.account_id left join profiles p on p.id=o.owner_user_id
    where o.status='open'
  )
  select jsonb_build_object(
    'forecast6', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from forecast6 f),
    'fiscal12', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from fiscal12 x),
    'reps', (select coalesce(jsonb_agg(to_jsonb(r) order by r.weighted desc), '[]') from reps r),
    'products', (select coalesce(jsonb_agg(to_jsonb(pp)), '[]') from prods pp),
    'no_next', (select coalesce(jsonb_agg(to_jsonb(b) order by b.amount desc), '[]') from (select * from base_open where next_action_date is null order by amount desc limit 8) b),
    'stale', (select coalesce(jsonb_agg(to_jsonb(b) order by b.amount desc), '[]') from (select * from base_open where last_activity_at is not null and last_activity_at < now() - interval '7 day' order by amount desc limit 8) b),
    'closing', (select coalesce(jsonb_agg(to_jsonb(b) order by b.amount desc), '[]') from (select * from base_open where date_trunc('month', expected_close_date) = cur_m order by amount desc limit 8) b)
  ) into result;
  return result;
end $function$;

-- ---- sales_alerts (0044ベース) ----
CREATE OR REPLACE FUNCTION public.sales_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  result jsonb;
begin
  with o as materialized (
    select id, account_id, owner_user_id, name, status, yomi, next_action_date,
           budget_status, proposal_doc_url, proposed_solution, lost_reason, reapproach_date
    from opportunities where tenant_id = any(v) and deleted_at is null
  ),
  a as materialized (
    select id, owner_user_id, name, rank, last_activity_date
    from accounts where tenant_id = any(v) and deleted_at is null
  ),
  alerts as (
    select 'ac_overdue' as kind, 0 as sev, o.account_id, o.id as opportunity_id, o.name as opportunity_name,
           o.owner_user_id, o.next_action_date as due_date
    from o where o.status='open' and o.next_action_date is not null and o.next_action_date < current_date
    union all
    select 'ac_missing', 1, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='open' and o.next_action_date is null
    union all
    select 'budget_unknown_b', 1, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='open' and yomi_stage(o.yomi) in ('B','A','commit')
      and (o.budget_status is null or o.budget_status='unknown')
    union all
    select 'no_proposal_a', 1, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='open' and yomi_stage(o.yomi) in ('A','commit')
      and o.proposal_doc_url is null and o.proposed_solution is null
    union all
    select 'lost_no_reason', 2, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='lost' and o.lost_reason is null
    union all
    select 'no_reapproach', 2, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='lost' and o.reapproach_date is null
      and (o.lost_reason is null or o.lost_reason not like '[再アプローチ不要]%')
    union all
    select 's_account_stale', 1, a.id, null, a.name, a.owner_user_id, a.last_activity_date
    from a where a.rank='S' and (a.last_activity_date is null or a.last_activity_date < current_date - 30)
    union all
    select 'a_account_stale', 2, a.id, null, a.name, a.owner_user_id, a.last_activity_date
    from a where a.rank='A' and (a.last_activity_date is null or a.last_activity_date < current_date - 60)
    union all
    select 'proposal_followup_7d', 0, t.account_id, t.opportunity_id, t.title, t.assigned_to, t.due_date
    from tasks t
    where t.tenant_id = any(v) and t.origin='followup7d' and t.status <> 'done'
      and t.due_date is not null and t.due_date < current_date
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', al.kind,
      'severity', case al.sev when 0 then 'high' when 1 then 'mid' else 'low' end,
      'account_id', al.account_id,
      'account_name', a2.name,
      'opportunity_id', al.opportunity_id,
      'opportunity_name', al.opportunity_name,
      'owner_user_id', al.owner_user_id,
      'due_date', al.due_date
    ) order by al.sev, al.due_date nulls last
  ), '[]'::jsonb) into result
  from alerts al
  left join a a2 on a2.id = al.account_id;
  return result;
end $function$;

-- ---- seminar_followup ----
CREATE OR REPLACE FUNCTION public.seminar_followup(p_seminar text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenants uuid[];
  v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants, 1) is null then
    return '[]'::jsonb;
  end if;

  with parts as materialized (
    select r.email, r.name, r.company, r.company_norm, r.job_title, r.employee_size,
           r.follow_up, r.comment, r.challenges, r.ai_usage, r.responded_at
    from seminar_responses r
    where r.seminar_name = p_seminar and r.tenant_id = any(v_tenants)
  ),
  lead_match as materialized (
    select p.email,
      (select to_jsonb(x) from (
         select l.id, l.raw_event, ls.name as source, l.acquired_at, l.funnel_stage,
                l.disposition, l.status, l.rank, l.owner_user_id
         from leads l left join lead_sources ls on ls.id = l.lead_source_id
         where lower(l.email) = p.email and l.tenant_id = any(v_tenants) and l.deleted_at is null
         order by l.acquired_at asc nulls last
         limit 1
      ) x) as lead
    from parts p
  ),
  hist as materialized (
    select p.email,
       coalesce(jsonb_agg(distinct jsonb_build_object('source', t.source, 'type', t.type))
         filter (where t.source is not null and t.source <> p_seminar), '[]'::jsonb) as touches,
       count(distinct t.source) filter (where t.source is not null and t.source <> p_seminar) as prior_sources
    from parts p
    left join touchpoints t on t.email = p.email and t.tenant_id = any(v_tenants)
    group by p.email
  ),
  opp_src as materialized (
    select norm_company(coalesce(a.name, o.name)) as cnorm,
           o.name, o.stage, o.status, o.amount, o.first_meeting_date,
           o.expected_close_date, o.notes, o.yomi
    from opportunities o
    left join accounts a on a.id = o.account_id
    where o.tenant_id = any(v_tenants) and o.deleted_at is null
  ),
  opps as materialized (
    select p.email,
      coalesce(jsonb_agg(jsonb_build_object(
         'name', o.name, 'stage', o.stage, 'status', o.status, 'amount', o.amount,
         'first_meeting_date', o.first_meeting_date, 'expected_close_date', o.expected_close_date,
         'notes', o.notes, 'yomi', o.yomi)
         order by o.first_meeting_date desc nulls last), '[]'::jsonb) as opps,
      count(*) as opp_count,
      count(*) filter (where o.status = 'open') as open_count,
      count(*) filter (where o.status = 'lost') as lost_count
    from parts p
    join opp_src o on o.cnorm = p.company_norm
    where p.company_norm is not null and p.company_norm <> ''
    group by p.email
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'email', p.email, 'name', p.name, 'company', p.company, 'company_norm', p.company_norm,
    'job_title', p.job_title, 'employee_size', p.employee_size,
    'follow_up', p.follow_up, 'memo', p.comment, 'challenges', p.challenges, 'ai_usage', p.ai_usage,
    'responded_at', p.responded_at,
    'lead', lm.lead,
    'engagement', jsonb_build_object('score', e.score, 'rank', e.rank, 'touch_count', e.touch_count),
    'history', coalesce(h.touches, '[]'::jsonb),
    'prior_sources', coalesce(h.prior_sources, 0),
    'opps', coalesce(op.opps, '[]'::jsonb),
    'opp_count', coalesce(op.opp_count, 0),
    'open_count', coalesce(op.open_count, 0),
    'lost_count', coalesce(op.lost_count, 0)
  ) order by p.responded_at), '[]'::jsonb)
  into v_result
  from parts p
  left join lead_match lm on lm.email = p.email
  left join person_engagement e on e.email = p.email and e.tenant_id = any(v_tenants)
  left join hist h on h.email = p.email
  left join opps op on op.email = p.email;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

-- ---- channel_roi ----
CREATE OR REPLACE FUNCTION public.channel_roi(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where tenant_id = any(v_tenants) and marketing_channel_id is not null and deleted_at is null
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
    where tenant_id = any(v_tenants) and marketing_channel_id is not null and deleted_at is null
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

-- ---- channel_level_matrix ----
CREATE OR REPLACE FUNCTION public.channel_level_matrix(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where tenant_id = any(v_tenants) and marketing_channel_id is not null and deleted_at is null
      and acquired_at >= p_start and acquired_at < p_end
    group by 1, 2
  ),
  wn as materialized (
    select o.marketing_channel_id mch, size_band(l.employee_size) band,
      count(*) deals, coalesce(sum(o.amount),0) revenue
    from opportunities o left join leads l on l.id = o.lead_id
    where o.tenant_id = any(v_tenants) and o.marketing_channel_id is not null and o.status='won' and o.deleted_at is null
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

-- ---- exhibition_breakdown ----
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
    'leads', coalesce(ld.leads,0), 'appts', coalesce(ld.appts,0),
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

-- ---- exhibition_deal_roi ----
CREATE OR REPLACE FUNCTION public.exhibition_deal_roi(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid[]; r jsonb;
begin
  v := array(select current_tenant_ids());
  if v is null or array_length(v,1) is null then return '[]'::jsonb; end if;
  with op as materialized (
    select btrim(source_detail) detail,
      count(*) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end) deals,
      coalesce(sum(amount) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end),0) revenue,
      count(*) filter (where status='open') open_deals,
      coalesce(sum(amount) filter (where status='open'),0) open_amount
    from opportunities
    where tenant_id = any(v) and source_detail is not null and btrim(source_detail) <> '' and deleted_at is null
    group by btrim(source_detail)
  ),
  c as materialized (select btrim(detail) detail, sum(cost) cost from deal_detail_costs where tenant_id = any(v) group by btrim(detail))
  select coalesce(jsonb_agg(jsonb_build_object(
    'detail', op.detail, 'deals', op.deals, 'revenue', op.revenue,
    'open_deals', op.open_deals, 'open_amount', op.open_amount, 'cost', coalesce(c.cost,0)
  ) order by op.revenue desc), '[]'::jsonb)
  into r from op left join c on c.detail = op.detail;
  return coalesce(r,'[]'::jsonb);
end; $function$;

-- ---- product_profitability ----
CREATE OR REPLACE FUNCTION public.product_profitability(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with prod as materialized (
    select id, name, category, is_recurring, default_gross_profit_rate, product_type, unit_cost, priority_flag, status
    from products where tenant_id = any(v_tenants)
  ),
  won as materialized (
    select primary_product_id pid,
      count(*) deals,
      coalesce(sum(amount),0) revenue,
      coalesce(sum(coalesce(gross_profit,0)),0) gp
    from opportunities
    where tenant_id = any(v_tenants) and status='won' and primary_product_id is not null and deleted_at is null
      and expected_close_date >= p_start and expected_close_date < p_end
    group by primary_product_id
  ),
  openp as materialized (
    select primary_product_id pid, count(*) open_deals, coalesce(sum(amount),0) open_amount
    from opportunities
    where tenant_id = any(v_tenants) and status='open' and primary_product_id is not null and deleted_at is null
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

-- ---- rescore_leads (削除済みリードはスコア再計算対象外に) ----
CREATE OR REPLACE FUNCTION public.rescore_leads(p_lead_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  n integer;
begin
  with base as materialized (
    select l.id, l.rank,
      (select coalesce(max((m[1])::int), 0) from regexp_matches(coalesce(l.employee_size,''), '([0-9]+)', 'g') as m) as emp_num,
      l.role_level, l.needs, l.timing, l.budget_band
    from leads l
    where l.tenant_id = any(v) and (p_lead_id is null or l.id = p_lead_id) and l.deleted_at is null
  ),
  final as (
    select id, rank,
      (case when emp_num >= 1000 then 20 when emp_num >= 300 then 15 when emp_num >= 100 then 10 when emp_num >= 30 then 5 when emp_num > 0 then 2 else 0 end) as s_size,
      (case role_level when 'exec' then 20 when 'officer' then 20 when 'manager' then 10 else 0 end) as s_role,
      (case needs when 'high' then 25 when 'mid' then 12 else 0 end) as s_issue,
      (case timing when 'now' then 15 when 'soon' then 10 else 0 end) as s_timing,
      (case budget_band when 'yes' then 20 when 'considering' then 10 else 0 end) as s_fit
    from base
  ),
  totaled as (
    select id, rank, s_size, s_role, s_issue, s_timing, s_fit,
      (s_size + s_role + s_issue + s_timing + s_fit) as total from final
  )
  update leads l set
    lead_score = f.total,
    lead_score_detail = jsonb_build_object(
      'size', f.s_size, 'role', f.s_role, 'issue', f.s_issue, 'timing', f.s_timing, 'fit', f.s_fit,
      'auto_rank', case when f.total >= 80 then 'S' when f.total >= 65 then 'A' when f.total >= 50 then 'B' when f.total >= 35 then 'C' else 'D' end
    ),
    rank = coalesce(nullif(l.rank, ''), case when f.total >= 80 then 'S' when f.total >= 65 then 'A' when f.total >= 50 then 'B' when f.total >= 35 then 'C' else 'D' end),
    first_contact_due_date = case
      when f.total >= 80 then current_date + 1
      when f.total >= 65 then current_date + 3
      when f.total >= 50 then current_date + 7
      else null end
  from totaled f
  where l.id = f.id;
  get diagnostics n = row_count;
  return n;
end $function$;

-- ============================================================
-- (4) ゴミ箱RPC
-- ============================================================

-- 一覧: テナント内の削除済みレコード(種別ごと最新200件)
create or replace function public.trash_list()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'leads', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select l.id, coalesce(nullif(l.company_name,''),'(会社名なし)')
            || case when l.contact_name is not null and l.contact_name <> '' then '｜' || l.contact_name else '' end as title,
          coalesce(l.raw_event,'') as sub, l.deleted_at,
          coalesce(p.display_name, p.email, '—') as deleted_by_name
        from leads l left join profiles p on p.id = l.deleted_by
        where l.tenant_id in (select current_tenant_ids()) and l.deleted_at is not null
        order by l.deleted_at desc limit 200
      ) t),
    'opportunities', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select o.id, coalesce(a.name || '｜', '') || o.name as title,
          coalesce(o.yomi,'') || case when o.amount > 0 then ' ・ ' || to_char(o.amount, 'FM999,999,999') || '円' else '' end as sub,
          o.deleted_at, coalesce(p.display_name, p.email, '—') as deleted_by_name
        from opportunities o
          left join accounts a on a.id = o.account_id
          left join profiles p on p.id = o.deleted_by
        where o.tenant_id in (select current_tenant_ids()) and o.deleted_at is not null
        order by o.deleted_at desc limit 200
      ) t),
    'accounts', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select a.id, a.name as title, coalesce(a.industry,'') as sub, a.deleted_at,
          coalesce(p.display_name, p.email, '—') as deleted_by_name
        from accounts a left join profiles p on p.id = a.deleted_by
        where a.tenant_id in (select current_tenant_ids()) and a.deleted_at is not null
        order by a.deleted_at desc limit 200
      ) t)
  );
$$;

-- 復元: 編集ロールなら可
create or replace function public.trash_restore(p_kind text, p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if p_kind = 'lead' then
    update leads set deleted_at = null, deleted_by = null
      where id = p_id and tenant_id in (select current_tenant_ids())
        and deleted_at is not null and can_edit_role(tenant_id);
  elsif p_kind = 'opportunity' then
    update opportunities set deleted_at = null, deleted_by = null
      where id = p_id and tenant_id in (select current_tenant_ids())
        and deleted_at is not null and can_edit_role(tenant_id);
  elsif p_kind = 'account' then
    update accounts set deleted_at = null, deleted_by = null
      where id = p_id and tenant_id in (select current_tenant_ids())
        and deleted_at is not null and can_edit_role(tenant_id);
  else
    return false;
  end if;
  return found;
end $$;

-- 完全削除(1件): owner/admin のみ。FK制約で消せない場合は false を返す(ゴミ箱に残る)
create or replace function public.trash_purge(p_kind text, p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  begin
    if p_kind = 'lead' then
      delete from leads
        where id = p_id and tenant_id in (select current_tenant_ids())
          and deleted_at is not null and current_role_in(tenant_id) in ('owner','admin');
    elsif p_kind = 'opportunity' then
      delete from opportunities
        where id = p_id and tenant_id in (select current_tenant_ids())
          and deleted_at is not null and current_role_in(tenant_id) in ('owner','admin');
    elsif p_kind = 'account' then
      delete from accounts
        where id = p_id and tenant_id in (select current_tenant_ids())
          and deleted_at is not null and current_role_in(tenant_id) in ('owner','admin');
    else
      return false;
    end if;
  exception when foreign_key_violation then
    return false;
  end;
  return found;
end $$;

-- 30日超過の自動パージ(cronからservice_roleで実行)。
-- 案件→リード→顧客の順(顧客のFK被参照を先に減らす)。FKで消せない行はスキップして残す。
create or replace function public.trash_purge_expired()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  rec record;
  n_opp int := 0; n_lead int := 0; n_acc int := 0;
begin
  for rec in select id from opportunities where deleted_at < now() - interval '30 days' loop
    begin
      delete from opportunities where id = rec.id;
      n_opp := n_opp + 1;
    exception when foreign_key_violation then null;
    end;
  end loop;
  for rec in select id from leads where deleted_at < now() - interval '30 days' loop
    begin
      delete from leads where id = rec.id;
      n_lead := n_lead + 1;
    exception when foreign_key_violation then null;
    end;
  end loop;
  for rec in select id from accounts where deleted_at < now() - interval '30 days' loop
    begin
      delete from accounts where id = rec.id;
      n_acc := n_acc + 1;
    exception when foreign_key_violation then null;
    end;
  end loop;
  return jsonb_build_object('opportunities', n_opp, 'leads', n_lead, 'accounts', n_acc);
end $$;

-- ============================================================
-- (5) 実行権限
-- ============================================================
revoke execute on function public.trash_list() from public, anon;
grant execute on function public.trash_list() to authenticated;
revoke execute on function public.trash_restore(text, uuid) from public, anon;
grant execute on function public.trash_restore(text, uuid) to authenticated;
revoke execute on function public.trash_purge(text, uuid) from public, anon;
grant execute on function public.trash_purge(text, uuid) to authenticated;
-- 自動パージは service_role 専用
revoke execute on function public.trash_purge_expired() from public, anon, authenticated;
grant execute on function public.trash_purge_expired() to service_role;
