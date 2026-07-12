-- 0120: 画面遷移の高速化 — workspace_lite / workspace_full のペイロード削減
-- pre_research(事前リサーチ)・sales_strategy(営業戦略)は長文で、opportunities JSONの
-- 約4割(計~770KB)を占めるが、読むのは案件詳細/商談詳細ページのみで、そこは
-- getWorkspaceForOpportunity の直接 select("*") を使うため本RPCには不要。
-- lite消費画面(一覧・ダッシュボード等)はこの2列を参照しない(2026-07-12 grep確認済)。
-- 効果実測: workspace_lite 全体 2,638KB→1,811KB(-31%) / opportunities 2,034KB→1,206KB(-41%)。

create or replace function public.workspace_lite()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (select id, email, display_name, avatar_color from profiles) p),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from memberships m),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from accounts a),
    'lead_sources', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from lead_sources s),
    'campaigns', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from campaigns c),
    'products', (select coalesce(jsonb_agg(to_jsonb(pr)), '[]'::jsonb) from products pr),
    'opportunities', (select coalesce(jsonb_agg(
        to_jsonb(o) - '{customer_issue,proposed_solution,hq_comment,hq_approval_status,meeting_doc_url,proposal_doc_url,competitor,budget_status,decision_maker_status,next_action_owner_id,reapproach_date,solution_package_id,win_reason,opportunity_type,external_ref,import_source,pre_research,sales_strategy}'::text[]
      ), '[]'::jsonb) from opportunities o),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tasks t),
    'sales_targets', (select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from sales_targets st),
    'rep_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb) from rep_targets rt)
  )
$function$;

create or replace function public.workspace_full()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (select id, email, display_name, avatar_color from profiles) p),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from memberships m),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from accounts a),
    'contacts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from contacts c),
    'lead_sources', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from lead_sources s),
    'campaigns', (select coalesce(jsonb_agg(to_jsonb(ca)), '[]'::jsonb) from campaigns ca),
    'products', (select coalesce(jsonb_agg(to_jsonb(pr)), '[]'::jsonb) from products pr),
    'opportunities', (select coalesce(jsonb_agg(
        to_jsonb(o) - '{pre_research,sales_strategy}'::text[]
      ), '[]'::jsonb) from opportunities o),
    'meetings', (select coalesce(jsonb_agg(to_jsonb(me)), '[]'::jsonb) from meetings me),
    'billing_schedules', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from billing_schedules b),
    'activities', (select coalesce(jsonb_agg(to_jsonb(ac)), '[]'::jsonb) from activities ac),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tasks t),
    'stage_histories', (select coalesce(jsonb_agg(to_jsonb(sh)), '[]'::jsonb) from stage_histories sh),
    'sales_targets', (select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from sales_targets st),
    'rep_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb) from rep_targets rt),
    'seminar_responses', (select coalesce(jsonb_agg(to_jsonb(sr)), '[]'::jsonb) from seminar_responses sr),
    'lead_import_batches', (select coalesce(jsonb_agg(to_jsonb(lib)), '[]'::jsonb) from lead_import_batches lib),
    'acquirer_aliases', (select coalesce(jsonb_agg(to_jsonb(aa)), '[]'::jsonb) from acquirer_aliases aa)
  )
$function$;
