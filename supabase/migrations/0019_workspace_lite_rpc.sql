-- 軽量ワークスペースを1往復で取得(RLS準拠・security invoker)。メニュー切替の高速化。
create or replace function workspace_lite() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (select id, email, display_name, avatar_color from profiles) p),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from memberships m),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from accounts a),
    'lead_sources', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from lead_sources s),
    'campaigns', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from campaigns c),
    'products', (select coalesce(jsonb_agg(to_jsonb(pr)), '[]'::jsonb) from products pr),
    'opportunities', (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from opportunities o),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tasks t),
    'sales_targets', (select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from sales_targets st),
    'rep_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb) from rep_targets rt)
  )
$$;
