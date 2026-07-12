-- パフォーマンス: 失注/成約分析をJS全件集計→単一集計RPCへ(データ増耐性)。
-- RLSバイパス(SECURITY DEFINER)のため、外部営業のownerスコープ(opps_select相当)を関数内で明示再現し越権を防ぐ。
create or replace function public.winloss_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  uid uuid := (select auth.uid());
  result jsonb;
begin
  with base as materialized (
    select o.id, o.name, o.status, coalesce(o.amount,0)::numeric as amount, o.category,
           o.lost_reason, o.lost_reason_code,
           coalesce(nullif(btrim(o.lost_competitor),''), nullif(btrim(o.competitor),'')) as competitor,
           o.expected_close_date, o.updated_at, a.name as acc
    from opportunities o
    left join accounts a on a.id = o.account_id
    where o.tenant_id = any(v)
      and o.deleted_at is null
      and o.status in ('won','lost')
      and (can_view_all(o.tenant_id) or o.owner_user_id = uid)  -- ownerスコープ保持
  )
  select jsonb_build_object(
    'won_count',  count(*) filter (where status='won'),
    'won_amount', coalesce(sum(amount) filter (where status='won'),0),
    'lost_count', count(*) filter (where status='lost'),
    'lost_by_reason', (
      select coalesce(jsonb_agg(jsonb_build_object('key',key,'count',cnt,'amount',amt) order by cnt desc),'[]'::jsonb)
      from (select coalesce(nullif(btrim(lost_reason_code),''),'未分類（自由記述のみ）') as key,
                   count(*) as cnt, sum(amount) as amt
            from base where status='lost' group by 1) r
    ),
    'lost_by_competitor', (
      select coalesce(jsonb_agg(jsonb_build_object('key',key,'count',cnt,'amount',amt) order by cnt desc),'[]'::jsonb)
      from (select competitor as key, count(*) as cnt, sum(amount) as amt
            from base where status='lost' and competitor is not null group by 1) c
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('category',category,'won',won,'lost',lost) order by (won+lost) desc),'[]'::jsonb)
      from (select coalesce(nullif(btrim(category),''),'未設定') as category,
                   count(*) filter (where status='won') as won,
                   count(*) filter (where status='lost') as lost
            from base group by 1) g
    ),
    'recent_lost', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id',id,'name',name,'account',acc,'amount',amount,'reason',lost_reason,
               'closedAt', coalesce(expected_close_date, updated_at::date))),'[]'::jsonb)
      from (select * from base where status='lost' order by updated_at desc nulls last limit 25) x
    )
  ) into result
  from base;
  return coalesce(result, '{}'::jsonb);
end $$;

revoke execute on function public.winloss_metrics() from public, anon;
grant execute on function public.winloss_metrics() to authenticated;
