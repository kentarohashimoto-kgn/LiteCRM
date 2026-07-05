-- グローバル検索: 顧客/案件/リードを横断してヘッダーから検索。
create or replace function public.global_search(p_q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    from accounts a where a.tenant_id = any(v) and a.name ilike '%'||q||'%'
    order by a.name limit 8
  ),
  opp as (
    select 'opportunity' as kind, o.id::text, coalesce(a.name,'') || '｜' || o.name as title,
      coalesce(o.yomi,'') || case when o.amount > 0 then ' ・ ' || to_char(o.amount, 'FM999,999,999') || '円' else '' end as sub
    from opportunities o left join accounts a on a.id = o.account_id
    where o.tenant_id = any(v) and (o.name ilike '%'||q||'%' or a.name ilike '%'||q||'%')
    order by o.last_activity_at desc nulls last limit 8
  ),
  ld as (
    select 'lead' as kind, l.id::text, coalesce(l.company_name,'') || case when l.contact_name is not null then '｜' || l.contact_name else '' end as title,
      coalesce(l.raw_event,'') || case when l.rank is not null then ' ・ ' || l.rank else '' end as sub
    from leads l
    where l.tenant_id = any(v) and (l.company_name ilike '%'||q||'%' or l.contact_name ilike '%'||q||'%')
    order by l.priority_score desc nulls last limit 8
  )
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into result
  from (select * from acc union all select * from opp union all select * from ld) x;
  return result;
end $$;

revoke execute on function public.global_search(text) from public, anon;
grant execute on function public.global_search(text) to authenticated;
