-- WO-03: 営業アラート(要件書8章)を読み取り時計算するRPC。
-- 次回AC超過/未設定・予算未確認・提案書なし・失注理由なし・S/A顧客未接触・提案後7日フォロー未了。
-- GUARDRAILS準拠: SECURITY DEFINER + 明示テナント + materialized CTE + search_path固定 + authenticated限定。

create or replace function public.sales_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  result jsonb;
begin
  with o as materialized (
    select id, account_id, owner_user_id, name, status, yomi, next_action_date,
           budget_status, proposal_doc_url, proposed_solution, lost_reason, reapproach_date
    from opportunities where tenant_id = any(v)
  ),
  a as materialized (
    select id, owner_user_id, name, rank, last_activity_date
    from accounts where tenant_id = any(v)
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
end $$;

revoke execute on function public.sales_alerts() from public, anon;
grant execute on function public.sales_alerts() to authenticated;
