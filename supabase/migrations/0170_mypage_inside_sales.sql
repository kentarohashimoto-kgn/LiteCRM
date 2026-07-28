-- =====================================================================
-- マイページ(個人カスタマイズホーム) + インサイドセールスロール + 営業数字の閲覧制限
--   (1) user_home_layouts: 個人ごとのマイページ・ガジェット配置(本人のみ読み書き)
--   (2) inside_sales ロール新設: アポ・商談登録が業務のため編集ロールに追加。
--       閲覧は RLS 既定の own-only(自分が担当の案件のみ)のまま。
--   (3) 営業数字の閲覧制限: security definer の集計RPC(dashboard_metrics /
--       dashboard_month_series / opportunities_page)がテナント内全員に全社数字を
--       返していたため、閲覧不可ロール(inside_sales / back_office / hr)には
--       「自分が担当する案件のみ」に絞る。既存ロールの見え方は変えない。
-- =====================================================================

-- ---- (1) マイページのレイアウト(1ユーザー×1テナントで1行) ----
create table if not exists public.user_home_layouts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
alter table public.user_home_layouts enable row level security;
-- 個人のホーム設定は本人のみ(管理者でも他人の配置は変更しない)
create policy user_home_layouts_own on public.user_home_layouts for all
  using (user_id = auth.uid() and tenant_id in (select current_tenant_ids()))
  with check (user_id = auth.uid() and tenant_id in (select current_tenant_ids()));

-- ---- (2) inside_sales はアポ・商談・活動の登録が必要なため編集ロールに追加 ----
create or replace function can_edit_role(p_tenant uuid)
returns boolean language sql stable as $$
  select current_role_in(p_tenant) in ('owner','admin','sales_manager','sales_rep','external_sales','inside_sales');
$$;

-- ---- (3) 営業数字(全社集計)を見てよいロールか ----
create or replace function public.can_view_sales_numbers(p_tenant uuid)
returns boolean language sql stable as $$
  select current_role_in(p_tenant) in
    ('owner','admin','sales_manager','viewer','sales_rep','external_sales','partner','delivery','finance');
$$;
revoke execute on function public.can_view_sales_numbers(uuid) from public, anon;
grant execute on function public.can_view_sales_numbers(uuid) to authenticated;

-- ---- dashboard_metrics (0063ベース + 閲覧制限) ----
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
      and (can_view_sales_numbers(o.tenant_id) or o.owner_user_id = auth.uid())
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

-- ---- dashboard_month_series (0102ベース + 閲覧制限) ----
create or replace function public.dashboard_month_series(p_center date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  s date := (date_trunc('month', p_center) - interval '6 month')::date;
  e date := (date_trunc('month', p_center) + interval '6 month')::date;
  result jsonb;
begin
  if v is null or array_length(v,1) is null then return '[]'::jsonb; end if;

  with o as materialized (
    select o.id, o.name, o.account_id, o.status, o.forecast_category, o.amount, o.yomi,
      round(o.amount * o.probability / 100.0) as weighted,
      date_trunc('month', coalesce(o.expected_revenue_month, o.expected_close_date))::date as rev_key,
      date_trunc('month', coalesce(o.expected_close_date, o.expected_revenue_month))::date as close_key,
      date_trunc('month', o.first_meeting_date)::date as meet_key
    from opportunities o
    where o.tenant_id = any(v) and o.deleted_at is null
      and (can_view_sales_numbers(o.tenant_id) or o.owner_user_id = auth.uid())
  ),
  months as (select gs.m::date as m from generate_series(s, e, interval '1 month') gs(m))
  select coalesce(jsonb_agg(jsonb_build_object(
    'month_key', to_char(m.m, 'YYYY-MM') || '-01',
    'ym', to_char(m.m, 'YYYY-MM'),
    'revenue',  (select coalesce(sum(o.amount),0) from o where o.status='won' and o.close_key = m.m),
    'deals',    (select count(*) from o where o.status='won' and o.close_key = m.m),
    'appts',    (select count(*) from o where o.meet_key = m.m),
    'wrevenue', (select coalesce(sum(case when o.status='won' then o.amount when o.status='open' then o.weighted else 0 end),0)
                 from o where o.rev_key = m.m and o.status in ('won','open')),
    'commit',   (select coalesce(sum(o.amount) filter (where o.status='open' and o.forecast_category='commit'),0)
                      + coalesce(sum(o.amount) filter (where o.status='won'),0) from o where o.rev_key = m.m),
    'bestcase', (select coalesce(sum(o.amount) filter (where o.status='open' and o.forecast_category in ('commit','best_case')),0)
                      + coalesce(sum(o.amount) filter (where o.status='won'),0) from o where o.rev_key = m.m),
    'weighted', (select coalesce(sum(o.weighted) filter (where o.status='open'),0)
                      + coalesce(sum(o.amount) filter (where o.status='won'),0) from o where o.rev_key = m.m),
    'won_deals', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'account', x.account, 'amount', x.amount) order by x.amount desc), '[]'::jsonb)
                  from (select o.name, (select a.name from accounts a where a.id=o.account_id) as account, o.amount
                        from o where o.status='won' and o.close_key = m.m order by o.amount desc limit 8) x),
    'open_deals', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'account', x.account, 'amount', x.amount,
                          'weighted', x.weighted, 'forecast_category', x.forecast_category, 'yomi', x.yomi) order by x.amount desc), '[]'::jsonb)
                  from (select o.name, (select a.name from accounts a where a.id=o.account_id) as account, o.amount, o.weighted, o.forecast_category, o.yomi
                        from o where o.status='open' and o.rev_key = m.m order by o.amount desc limit 8) x)
  ) order by m.m), '[]'::jsonb)
  into result from months m;
  return result;
end; $$;

-- ---- sales_alerts (0073ベース + 閲覧制限) ----
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
      and (can_view_sales_numbers(tenant_id) or owner_user_id = auth.uid())
  ),
  a as materialized (
    select id, owner_user_id, name, rank, last_activity_date
    from accounts where tenant_id = any(v) and deleted_at is null
      and (can_view_sales_numbers(tenant_id) or owner_user_id = auth.uid())
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
      and not exists (select 1 from proposal_versions pv where pv.opportunity_id = o.id)
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
      and (can_view_sales_numbers(t.tenant_id) or t.assigned_to = auth.uid())
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

-- ---- opportunities_page (0162ベース + 閲覧制限) ----
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
  f_sd text := nullif(p_filter->>'campaign', '');
  only_no_next boolean := coalesce((p_filter->>'only_no_next')::boolean, false);
  only_stale boolean := coalesce((p_filter->>'only_stale')::boolean, false);
  sort_col text := case p_sort
    when 'name' then 'a.name'
    when 'yomi' then 'o.yomi'
    when 'owner' then 'p.display_name'
    when 'product' then 'pr.name'
    when 'source_detail' then 'o.source_detail'
    when 'stage' then 'o.stage'
    when 'amount' then 'o.amount'
    when 'probability' then 'o.probability'
    when 'next_action_date' then 'coalesce(na.due, o.next_action_date)'
    when 'last_activity_at' then 'o.last_activity_at'
    when 'meeting_count' then '(select count(*) from meetings mt where mt.opportunity_id = o.id)'
    when 'last_meeting_date' then '(select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id)'
    else 'o.expected_close_date' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with f as (
      select o.id, o.name, a.name as account_name, o.yomi, o.owner_user_id,
        coalesce(p.display_name, p.email, '—') as owner_name, p.avatar_color as owner_color,
        o.primary_product_id, pr.name as product_name, o.campaign_id, c.name as campaign_name, o.campaign_estimated,
        o.lead_source_id, ls.name as source_name, o.source_detail,
        o.amount, o.stage, o.probability, o.forecast_category, o.status, o.deal_phase,
        o.expected_close_date, o.expected_revenue_month,
        coalesce(na.due, o.next_action_date) as next_action_date,
        coalesce(na.title, o.next_action_text) as next_action_text,
        o.notes, o.last_activity_at,
        o.risk_level, o.first_meeting_date, o.appointment_at, o.created_at, o.updated_at,
        (select count(*) from meetings mt where mt.opportunity_id = o.id)::int as meeting_count,
        (select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id) as last_meeting_date,
        case
          when na.due is not null then 'open'
          when exists(select 1 from tasks t where t.opportunity_id = o.id and t.origin = 'next_action' and t.status = 'done') then 'done'
          else null
        end as next_action_status,
        coalesce(
          na.id,
          (select t.id from tasks t where t.opportunity_id = o.id and t.origin = 'next_action'
             order by (t.status = 'done') asc, t.created_at desc limit 1)
        ) as next_action_task_id,
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
        left join lateral (
          select t.id, t.due_date as due, t.title
          from tasks t
          where t.opportunity_id = o.id and t.origin = 'next_action' and t.status <> 'done'
          order by t.due_date asc nulls last, t.created_at desc
          limit 1
        ) na on true
      where o.tenant_id = any($1)
        and o.deleted_at is null
        and (can_view_sales_numbers(o.tenant_id) or o.owner_user_id = auth.uid())
        and ($2 is null or o.name ilike '%%' || $2 || '%%' or a.name ilike '%%' || $2 || '%%')
        and ($3 is null or o.yomi = any($3))
        and ($4 is null or o.owner_user_id = $4)
        and ($5 is null or o.primary_product_id = $5)
        and ($6 is null or o.lead_source_id = $6)
        and ($7 is null or btrim(o.source_detail) = $7)
        and (not $8 or (o.status = 'open' and na.due is null))
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
  using v, q, yomi, f_owner, f_product, f_source, f_sd, only_no_next, only_stale, p_limit, p_offset;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'sum_amount', 0, 'sum_weighted', 0));
end $function$;
