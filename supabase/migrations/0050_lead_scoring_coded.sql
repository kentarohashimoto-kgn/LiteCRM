-- WO-06修正: rescore_leads を、リード詳細フォームの実際のコード値(needs=high/mid/low,
-- timing=now/soon/unknown, budget_band=yes/considering/no, role_level=exec/officer/manager/staff)
-- に合わせて再定義。要件書4.10の5軸: 規模20/役職20/課題(needs)25/時期15/相性(予算readiness)20 = 100。
create or replace function public.rescore_leads(p_lead_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  n integer;
begin
  with base as materialized (
    select l.id, l.rank,
      (select coalesce(max((m[1])::int), 0) from regexp_matches(coalesce(l.employee_size,''), '([0-9]+)', 'g') as m) as emp_num,
      l.role_level, l.needs, l.timing, l.budget_band
    from leads l
    where l.tenant_id = any(v) and (p_lead_id is null or l.id = p_lead_id)
  ),
  final as (
    select id, rank,
      (case when emp_num >= 1000 then 20 when emp_num >= 300 then 15 when emp_num >= 100 then 10 when emp_num >= 30 then 5 when emp_num > 0 then 2 else 0 end) as s_size,
      (case role_level when 'exec' then 20 when 'officer' then 20 when 'manager' then 10 else 0 end) as s_role,
      (case needs when 'high' then 25 when 'mid' then 12 else 0 end) as s_issue,
      (case timing when 'now' then 15 when 'soon' then 10 else 0 end) as s_timing,
      (case budget_band when 'yes' then 20 when 'considering' then 10 else 0 end) as s_fit
    from base
  ),
  totaled as (
    select id, rank, s_size, s_role, s_issue, s_timing, s_fit,
      (s_size + s_role + s_issue + s_timing + s_fit) as total from final
  )
  update leads l set
    lead_score = f.total,
    lead_score_detail = jsonb_build_object(
      'size', f.s_size, 'role', f.s_role, 'issue', f.s_issue, 'timing', f.s_timing, 'fit', f.s_fit,
      'auto_rank', case when f.total >= 80 then 'S' when f.total >= 65 then 'A' when f.total >= 50 then 'B' when f.total >= 35 then 'C' else 'D' end
    ),
    rank = coalesce(nullif(l.rank, ''), case when f.total >= 80 then 'S' when f.total >= 65 then 'A' when f.total >= 50 then 'B' when f.total >= 35 then 'C' else 'D' end),
    first_contact_due_date = case
      when f.total >= 80 then current_date + 1
      when f.total >= 65 then current_date + 3
      when f.total >= 50 then current_date + 7
      else null end
  from totaled f
  where l.id = f.id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.rescore_leads(uuid) from public, anon;
grant execute on function public.rescore_leads(uuid) to authenticated;
