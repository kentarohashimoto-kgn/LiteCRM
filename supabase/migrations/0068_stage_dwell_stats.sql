-- C-5 ステージ滞留分析: stage_histories(既存データ)から
--   - ステージ別の平均/中央値 滞留日数(完了した区間)
--   - ヨミ別の現在滞留状況(進行中案件)
--   - 滞留が長い進行中案件 上位30件
--   - 受注リードタイム(作成→受注予定日)
create or replace function public.stage_dwell_stats()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  result jsonb;
begin
  with h as (
    select sh.opportunity_id, sh.to_stage, sh.changed_at,
      lead(sh.changed_at) over (partition by sh.opportunity_id order by sh.changed_at) as next_at
    from stage_histories sh
    where sh.tenant_id = any(v)
  ),
  completed as (
    select to_stage as stage, extract(epoch from (next_at - changed_at)) / 86400.0 as days
    from h where next_at is not null
  ),
  stage_stats as (
    select stage, count(*)::int as n,
      round(avg(days)::numeric, 1) as avg_days,
      round((percentile_cont(0.5) within group (order by days))::numeric, 1) as med_days
    from completed group by stage
  ),
  last_change as (
    select opportunity_id, max(changed_at) as at from h group by opportunity_id
  ),
  open_base as (
    select o.id, o.name, a.name as account_name, o.yomi, o.stage, o.amount, o.next_action_date,
      coalesce(p.display_name, p.email, '—') as owner_name,
      floor(extract(epoch from (now() - coalesce(lc.at, o.created_at))) / 86400)::int as days_in_stage
    from opportunities o
      left join last_change lc on lc.opportunity_id = o.id
      left join accounts a on a.id = o.account_id
      left join profiles p on p.id = o.owner_user_id
    where o.tenant_id = any(v) and o.status = 'open' and o.deleted_at is null
  ),
  yomi_dwell as (
    select coalesce(yomi, '(未設定)') as yomi, count(*)::int as n,
      round(avg(days_in_stage)::numeric, 1) as avg_days,
      max(days_in_stage) as max_days
    from open_base group by coalesce(yomi, '(未設定)')
  ),
  lead_time as (
    select count(*)::int as n,
      round(avg(o.expected_close_date - o.created_at::date)::numeric, 0) as avg_days,
      round((percentile_cont(0.5) within group (order by (o.expected_close_date - o.created_at::date)))::numeric, 0) as med_days
    from opportunities o
    where o.tenant_id = any(v) and o.status = 'won' and o.deleted_at is null
      and o.expected_close_date is not null and o.expected_close_date >= o.created_at::date
  )
  select jsonb_build_object(
    'stages', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from stage_stats s),
    'yomi', (select coalesce(jsonb_agg(to_jsonb(y) order by y.yomi), '[]'::jsonb) from yomi_dwell y),
    'open_dwell', (select coalesce(jsonb_agg(to_jsonb(d) order by d.days_in_stage desc), '[]'::jsonb)
                   from (select * from open_base order by days_in_stage desc limit 30) d),
    'lead_time', (select to_jsonb(l) from lead_time l)
  ) into result;
  return coalesce(result, '{}'::jsonb);
end $$;

revoke execute on function public.stage_dwell_stats() from public, anon;
grant execute on function public.stage_dwell_stats() to authenticated;
