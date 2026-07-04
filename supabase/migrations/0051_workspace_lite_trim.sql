-- 性能改善: workspace_lite の opportunities から一覧/集計で不要な詳細専用カラムを除外。
-- 案件JSONを約27%削減(1114kB→813kB)。詳細ページはスコープ付き取得に移行済みのため影響なし。
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
        to_jsonb(o) - '{customer_issue,proposed_solution,hq_comment,hq_approval_status,meeting_doc_url,proposal_doc_url,competitor,budget_status,decision_maker_status,next_action_owner_id,reapproach_date,solution_package_id,win_reason,opportunity_type,external_ref,import_source}'::text[]
      ), '[]'::jsonb) from opportunities o),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tasks t),
    'sales_targets', (select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from sales_targets st),
    'rep_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb) from rep_targets rt)
  )
$function$;
