-- =====================================================================
-- 0178: rescore_leads の性能改善（リード1万件超でタイムアウトしないように）
--   名刺の一括リード化でリードが 8,286 → 11,449 件に増え、全件再スコアが
--   60秒を超えるようになった（authenticated の statement_timeout に抵触）。
--   原因は totals CTE の相関サブクエリ（リード1件ごとに per_axis を2回走査）。
--   LEFT JOIN + GROUP BY の1パス集計に置き換える。ロジック・結果は不変。
--   実測: 集計部が 268ms（EXPLAIN ANALYZE / 11,449件）。
-- =====================================================================

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
    select l.id, l.tenant_id, l.rank,
      (select coalesce(max((m[1])::int), 0) from regexp_matches(coalesce(l.employee_size,''), '([0-9]+)', 'g') as m) as emp_num,
      coalesce(l.role_level,'') as role_level, coalesce(l.job_title,'') as job_title,
      coalesce(l.industry,'') as industry,
      coalesce(l.needs,'') as needs, coalesce(l.timing,'') as timing, coalesce(l.budget_band,'') as budget_band,
      coalesce(l.handled_by,'') as handled_by,
      (coalesce(l.needs,'') || ' ' || coalesce(l.notes,'') || ' ' || coalesce(l.tags::text,'')) as fulltext
    from leads l
    where l.tenant_id = any(v) and (p_lead_id is null or l.id = p_lead_id)
  ),
  hits as (
    select b.id as lead_id, b.tenant_id, r.axis, r.points
    from base b
    join lead_scoring_rules r on r.tenant_id = b.tenant_id and r.is_active
    where case r.match_kind
      when 'employee_gte'      then b.emp_num >= coalesce(nullif(regexp_replace(r.match_value,'[^0-9]','','g'),'')::int, 0)
      when 'role_level_in'     then b.role_level <> '' and b.role_level = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'title_regex'       then b.job_title <> '' and b.job_title ~ r.match_value
      when 'industry_includes' then b.industry <> '' and b.industry ~ r.match_value
      when 'needs_in'          then b.needs <> '' and b.needs = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'timing_in'         then b.timing <> '' and b.timing = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'budget_in'         then b.budget_band <> '' and b.budget_band = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'text_includes'     then b.fulltext ~ r.match_value
      when 'handled_by_in'     then b.handled_by <> '' and b.handled_by = any(string_to_array(r.match_value, ','))
      else false end
  ),
  per_axis as (
    select h.lead_id, h.tenant_id, h.axis,
      least(a.cap, case when a.agg = 'sum' then sum(h.points) else max(h.points) end)::int as pts
    from hits h
    join lead_scoring_axes a on a.tenant_id = h.tenant_id and a.axis = h.axis
    group by h.lead_id, h.tenant_id, h.axis, a.cap, a.agg
  ),
  caps as (
    select a.tenant_id, sum(a.cap)::int as total_cap
    from lead_scoring_axes a
    where exists (select 1 from lead_scoring_rules r where r.tenant_id = a.tenant_id and r.axis = a.axis and r.is_active)
    group by a.tenant_id
  ),
  -- 相関サブクエリを廃し、LEFT JOIN + GROUP BY の1パス集計にする(性能改善の要点)
  totals as (
    select b.id, b.tenant_id,
      coalesce(sum(pa.pts), 0)::int as raw,
      coalesce(jsonb_object_agg(pa.axis, pa.pts) filter (where pa.axis is not null), '{}'::jsonb) as detail
    from base b
    left join per_axis pa on pa.lead_id = b.id
    group by b.id, b.tenant_id
  ),
  final as (
    select t.id, t.detail, t.raw,
      case when coalesce(c.total_cap, 0) > 0
        then least(100, round(100.0 * t.raw / c.total_cap))::int
        else 0 end as score
    from totals t left join caps c on c.tenant_id = t.tenant_id
  )
  update leads l set
    lead_score = f.score,
    lead_score_detail = f.detail || jsonb_build_object(
      'raw', f.raw,
      'auto_rank', case when f.score >= 80 then 'S' when f.score >= 65 then 'A' when f.score >= 50 then 'B' when f.score >= 35 then 'C' else 'D' end
    ),
    rank = coalesce(nullif(l.rank, ''), case when f.score >= 80 then 'S' when f.score >= 65 then 'A' when f.score >= 50 then 'B' when f.score >= 35 then 'C' else 'D' end)
  from final f
  where l.id = f.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.rescore_leads(uuid) from public, anon;
grant execute on function public.rescore_leads(uuid) to authenticated;
