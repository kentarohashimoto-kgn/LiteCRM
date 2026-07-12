-- パフォーマンス: 商談チェック(抜け漏れ)をJS全件判定→SQL集計RPCへ。
-- 6項目の充足判定はフィールド有無のみ(既存 checklist.ts の recorded() を忠実移植)。
-- ownerスコープ(can_view_all or owner=uid)を関数内で再現し越権防止。
create or replace function public.checklist_metrics()
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
    select o.id, o.name, o.yomi, coalesce(o.amount,0)::numeric as amount, a.name as acc,
      (coalesce(btrim(o.customer_issue),'') <> '') as d_issue,
      (coalesce(btrim(o.proposed_solution),'') <> '') as d_solution,
      (o.next_action_date is not null) as d_next,
      (coalesce(btrim(o.decision_maker_status),'') not in ('','未確認','未','未定','unknown','none','なし')) as d_dm,
      (coalesce(btrim(o.budget_status),'') not in ('','未確認','未','未定','unknown','none','なし')) as d_budget,
      (case when o.proposal_required
            then coalesce(btrim(o.proposal_status),'') not in ('','未確認','未','未定','unknown','none','なし')
            else true end) as d_proposal
    from opportunities o
    left join accounts a on a.id = o.account_id
    where o.tenant_id = any(v) and o.deleted_at is null and o.status = 'open'
      and (can_view_all(o.tenant_id) or o.owner_user_id = uid)
  ),
  scored as (
    select *,
      (d_issue::int + d_solution::int + d_next::int + d_dm::int + d_budget::int + d_proposal::int) as done_count
    from base
  )
  select jsonb_build_object(
    'total', count(*),
    'gapCount', count(*) filter (where done_count < 6),
    'avgRate', coalesce(avg(done_count::numeric / 6), 0),
    'opps', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'account', acc, 'yomi', yomi, 'amount', amount,
      'done', jsonb_build_object('issue',d_issue,'solution',d_solution,'next',d_next,'dm',d_dm,'budget',d_budget,'proposal',d_proposal),
      'doneCount', done_count
    ) order by done_count asc, amount desc), '[]'::jsonb)
  ) into result
  from scored;
  return coalesce(result, '{}'::jsonb);
end $$;

revoke execute on function public.checklist_metrics() from public, anon;
grant execute on function public.checklist_metrics() to authenticated;
