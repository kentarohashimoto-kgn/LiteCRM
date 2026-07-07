-- 営業レントゲン診断のメトリクスを一括取得するRPC。
-- コホート基準(期間内に獲得したリード/アポの到達状況)と計上基準(期間内の受注売上)の両方を返す。
-- アポ獲得日は appt_acquired_on → first_meeting_date → created_at の順にフォールバック
-- (一括インポート案件のcreated_atが登録日に集中しているため、first_meeting_dateを実質の獲得日として使う)。
create or replace function public.xray_metrics(p_start date, p_end date, p_cmp_start date, p_cmp_end date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  result jsonb;
begin
  if v is null or array_length(v,1) is null then return '{}'::jsonb; end if;

  with ranges as (
    select 'cur' as tag, p_start as s, p_end as e
    union all
    select 'cmp', p_cmp_start, p_cmp_end
  ),
  lead_m as (
    select r.tag, count(l.id)::int as leads
    from ranges r
    left join leads l on l.tenant_id = any(v) and l.deleted_at is null
      and l.acquired_at >= r.s and l.acquired_at < r.e
    group by r.tag
  ),
  opp_m as (
    select r.tag,
      count(o.id)::int as appts,
      count(*) filter (where o.status='won' or o.yomi in ('0.受注','1.A(80%)','2.B(50%)','3.C(30%)','6.定期追い','7.オチ'))::int as meets,
      count(*) filter (where o.status='won')::int as won,
      coalesce(sum(o.amount) filter (where o.status='won'),0)::numeric as revenue,
      count(*) filter (where o.yomi='5.リスケ')::int as st_resched,
      count(*) filter (where o.yomi='8.キャンセル')::int as st_cancel,
      count(*) filter (where o.yomi='9.調整中')::int as st_pending,
      count(*) filter (where o.yomi='4.アポ')::int as st_appt
    from ranges r
    left join opportunities o on o.tenant_id = any(v) and o.deleted_at is null
      and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) >= r.s
      and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) < r.e
    group by r.tag
  ),
  booked as (
    select r.tag,
      count(o.id)::int as won_booked,
      coalesce(sum(o.amount),0)::numeric as revenue_booked,
      coalesce(sum(o.amount) filter (where exists (
        select 1 from opportunities p
        where p.account_id = o.account_id and p.status='won' and p.deleted_at is null and p.id <> o.id
          and coalesce(p.expected_close_date, p.created_at::date) < coalesce(o.expected_close_date, o.created_at::date)
      )),0)::numeric as revenue_exist
    from ranges r
    left join opportunities o on o.tenant_id = any(v) and o.deleted_at is null and o.status='won'
      and coalesce(o.expected_close_date, o.created_at::date) >= r.s
      and coalesce(o.expected_close_date, o.created_at::date) < r.e
    group by r.tag
  ),
  fu as (
    select r.tag,
      count(m.id)::int as fu_due,
      count(*) filter (where m.schedule_status='done' or m.held_on is not null)::int as fu_held,
      count(*) filter (where m.proposal_done)::int as fu_proposals,
      count(*) filter (where m.upsell_status is not null and m.upsell_status not in ('none'))::int as fu_upsell
    from ranges r
    left join fu_meetings m on m.tenant_id = any(v)
      and m.due_date >= r.s and m.due_date < r.e
    group by r.tag
  ),
  merged as (
    select r.tag,
      jsonb_build_object(
        'leads', lm.leads, 'appts', om.appts, 'meets', om.meets, 'won', om.won, 'revenue', om.revenue,
        'st_resched', om.st_resched, 'st_cancel', om.st_cancel, 'st_pending', om.st_pending, 'st_appt', om.st_appt,
        'won_booked', bk.won_booked, 'revenue_booked', bk.revenue_booked, 'revenue_exist', bk.revenue_exist,
        'fu_due', f.fu_due, 'fu_held', f.fu_held, 'fu_proposals', f.fu_proposals, 'fu_upsell', f.fu_upsell
      ) as body
    from ranges r
    join lead_m lm on lm.tag = r.tag
    join opp_m om on om.tag = r.tag
    join booked bk on bk.tag = r.tag
    join fu f on f.tag = r.tag
  ),
  tg as (
    select jsonb_build_object(
      'amount', coalesce(sum(target_amount),0),
      'leads', coalesce(sum(target_leads),0),
      'appointments', coalesce(sum(target_appointments),0),
      'deals', coalesce(sum(target_deals),0),
      'months', count(*)
    ) as body
    from sales_targets
    where tenant_id = any(v)
      and target_month >= date_trunc('month', p_start)::date
      and target_month < p_end
  ),
  months as (
    select generate_series(
      date_trunc('month', p_end - interval '11 months')::date,
      date_trunc('month', p_end)::date,
      interval '1 month'
    )::date as m
  ),
  monthly as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'ym', to_char(mo.m, 'YYYY-MM'),
      'leads', (select count(*) from leads l where l.tenant_id=any(v) and l.deleted_at is null
                and l.acquired_at >= mo.m and l.acquired_at < (mo.m + interval '1 month')::date),
      'appts', (select count(*) from opportunities o where o.tenant_id=any(v) and o.deleted_at is null
                and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) >= mo.m
                and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) < (mo.m + interval '1 month')::date),
      'won', (select count(*) from opportunities o where o.tenant_id=any(v) and o.deleted_at is null and o.status='won'
              and coalesce(o.expected_close_date, o.created_at::date) >= mo.m
              and coalesce(o.expected_close_date, o.created_at::date) < (mo.m + interval '1 month')::date),
      'revenue', (select coalesce(sum(o.amount),0) from opportunities o where o.tenant_id=any(v) and o.deleted_at is null and o.status='won'
              and coalesce(o.expected_close_date, o.created_at::date) >= mo.m
              and coalesce(o.expected_close_date, o.created_at::date) < (mo.m + interval '1 month')::date)
    ) order by mo.m), '[]'::jsonb) as body
    from months mo
  ),
  exh as (
    select coalesce(jsonb_agg(x order by x.leads desc), '[]'::jsonb) as body
    from (
      select l.raw_event as name, count(*)::int as leads,
        (select count(*) from opportunities o where o.tenant_id=any(v) and o.deleted_at is null
          and btrim(o.source_detail) = l.raw_event
          and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) >= p_start
          and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) < p_end)::int as appts
      from leads l
      where l.tenant_id=any(v) and l.deleted_at is null and l.raw_event is not null
        and l.acquired_at >= p_start and l.acquired_at < p_end
      group by l.raw_event
      order by count(*) desc limit 10
    ) x
  ),
  reps as (
    select coalesce(jsonb_agg(x order by x.appts desc), '[]'::jsonb) as body
    from (
      select coalesce(p.display_name, p.email, '—') as name,
        count(*)::int as appts,
        count(*) filter (where o.status='won' or o.yomi in ('0.受注','1.A(80%)','2.B(50%)','3.C(30%)','6.定期追い','7.オチ'))::int as meets,
        count(*) filter (where o.status='won')::int as won,
        coalesce(sum(o.amount) filter (where o.status='won'),0)::numeric as revenue
      from opportunities o
      left join profiles p on p.id = o.owner_user_id
      where o.tenant_id=any(v) and o.deleted_at is null
        and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) >= p_start
        and coalesce(o.appt_acquired_on, o.first_meeting_date, o.created_at::date) < p_end
      group by 1
      order by count(*) desc limit 10
    ) x
  ),
  prods as (
    select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) as body
    from (
      select coalesce(pr.name, '未設定') as name, count(*)::int as won, coalesce(sum(o.amount),0)::numeric as revenue
      from opportunities o
      left join products pr on pr.id = o.primary_product_id
      where o.tenant_id=any(v) and o.deleted_at is null and o.status='won'
        and coalesce(o.expected_close_date, o.created_at::date) >= p_start
        and coalesce(o.expected_close_date, o.created_at::date) < p_end
      group by 1
      order by 3 desc limit 10
    ) x
  )
  select jsonb_build_object(
    'cur', (select body from merged where tag='cur'),
    'cmp', (select body from merged where tag='cmp'),
    'targets', (select body from tg),
    'monthly', (select body from monthly),
    'exhibitions', (select body from exh),
    'reps', (select body from reps),
    'products', (select body from prods)
  ) into result;

  return coalesce(result, '{}'::jsonb);
end $$;
