-- セミナー攻略リスト用 RPC。
-- 参加者(seminar_responses)を過去リード(流入元/獲得日)・過去商談・エンゲージメント・接点履歴と突合し、
-- フォロー優先度の算出に必要なデータを1往復で返す。セキュリティはinvoker(RLS準拠)。

create or replace function public.seminar_followup(p_seminar text)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with parts as (
    select r.email, r.name, r.company, r.company_norm, r.job_title, r.employee_size,
           r.follow_up, r.comment, r.challenges, r.ai_usage, r.responded_at
    from seminar_responses r
    where r.seminar_name = p_seminar
  ),
  lead_match as (
    select p.email,
      (select to_jsonb(x) from (
         select l.id, l.raw_event, ls.name as source, l.acquired_at, l.funnel_stage,
                l.disposition, l.status, l.rank, l.owner_user_id
         from leads l left join lead_sources ls on ls.id = l.lead_source_id
         where lower(l.email) = p.email
         order by l.acquired_at asc nulls last
         limit 1
      ) x) as lead
    from parts p
  ),
  hist as (
    select p.email,
       coalesce(jsonb_agg(distinct jsonb_build_object('source', t.source, 'type', t.type))
         filter (where t.source is not null and t.source <> p_seminar), '[]'::jsonb) as touches,
       count(distinct t.source) filter (where t.source is not null and t.source <> p_seminar) as prior_sources
    from parts p left join touchpoints t on t.email = p.email
    group by p.email
  ),
  opps as (
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
    join opportunities o
      on norm_company(coalesce((select a.name from accounts a where a.id = o.account_id), o.name)) = p.company_norm
     and p.company_norm is not null and p.company_norm <> ''
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
  from parts p
  left join lead_match lm on lm.email = p.email
  left join person_engagement e on e.email = p.email and e.tenant_id in (select current_tenant_ids())
  left join hist h on h.email = p.email
  left join opps op on op.email = p.email;
$function$;

create or replace function public.seminar_list()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by x.last_at desc), '[]'::jsonb)
  from (
    select seminar_name as name, count(*) as participants, max(responded_at) as last_at
    from seminar_responses
    group by seminar_name
  ) x;
$function$;
