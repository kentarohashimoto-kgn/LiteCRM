-- ============================================================
-- 案件一覧 RPC に next_action_task_id を追加
--   案件一覧の行から次回ACを直接「完了/未完了」トグルできるよう、
--   対象となる next_action タスクのIDを返す。
--   優先順: オープンなタスク（最新）> 完了タスク（最新）。
--   （0135 の定義に列を1つ追加して再作成）
-- ============================================================
CREATE OR REPLACE FUNCTION public.opportunities_page(p_filter jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT 'expected_close_date'::text, p_asc boolean DEFAULT true, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  yomi text[] := case when jsonb_typeof(p_filter->'yomi') = 'array' and jsonb_array_length(p_filter->'yomi') > 0
                      then array(select jsonb_array_elements_text(p_filter->'yomi')) else null end;
  f_owner uuid := nullif(p_filter->>'owner', '')::uuid;
  f_product uuid := nullif(p_filter->>'product', '')::uuid;
  f_source uuid := nullif(p_filter->>'source', '')::uuid;
  f_sd text := nullif(p_filter->>'campaign', '');
  only_no_next boolean := coalesce((p_filter->>'only_no_next')::boolean, false);
  only_stale boolean := coalesce((p_filter->>'only_stale')::boolean, false);
  sort_col text := case p_sort
    when 'name' then 'a.name'
    when 'yomi' then 'o.yomi'
    when 'owner' then 'p.display_name'
    when 'product' then 'pr.name'
    when 'source_detail' then 'o.source_detail'
    when 'stage' then 'o.stage'
    when 'amount' then 'o.amount'
    when 'probability' then 'o.probability'
    when 'next_action_date' then 'o.next_action_date'
    when 'last_activity_at' then 'o.last_activity_at'
    when 'meeting_count' then '(select count(*) from meetings mt where mt.opportunity_id = o.id)'
    when 'last_meeting_date' then '(select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id)'
    else 'o.expected_close_date' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with f as (
      select o.id, o.name, a.name as account_name, o.yomi, o.owner_user_id,
        coalesce(p.display_name, p.email, '—') as owner_name, p.avatar_color as owner_color,
        o.primary_product_id, pr.name as product_name, o.campaign_id, c.name as campaign_name, o.campaign_estimated,
        o.lead_source_id, ls.name as source_name, o.source_detail,
        o.amount, o.stage, o.probability, o.forecast_category, o.status, o.deal_phase,
        o.expected_close_date, o.expected_revenue_month, o.next_action_date, o.next_action_text, o.notes, o.last_activity_at,
        o.risk_level, o.first_meeting_date, o.appointment_at, o.created_at, o.updated_at,
        (select count(*) from meetings mt where mt.opportunity_id = o.id)::int as meeting_count,
        (select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id) as last_meeting_date,
        case
          when o.next_action_date is null then null
          when exists(select 1 from tasks t where t.opportunity_id = o.id and t.origin = 'next_action' and t.status <> 'done') then 'open'
          when exists(select 1 from tasks t where t.opportunity_id = o.id and t.origin = 'next_action' and t.status = 'done') then 'done'
          else 'open'
        end as next_action_status,
        (select t.id from tasks t where t.opportunity_id = o.id and t.origin = 'next_action'
           order by (t.status = 'done') asc, t.created_at desc limit 1) as next_action_task_id,
        round(o.amount * o.probability / 100.0) as weighted,
        count(*) over() as total,
        sum(o.amount) over() as sum_amount,
        sum(round(o.amount * o.probability / 100.0)) over() as sum_weighted,
        row_number() over(order by %s %s nulls last) as rn
      from opportunities o
        left join accounts a on a.id = o.account_id
        left join profiles p on p.id = o.owner_user_id
        left join products pr on pr.id = o.primary_product_id
        left join campaigns c on c.id = o.campaign_id
        left join lead_sources ls on ls.id = o.lead_source_id
      where o.tenant_id = any($1)
        and o.deleted_at is null
        and ($2 is null or o.name ilike '%%' || $2 || '%%' or a.name ilike '%%' || $2 || '%%')
        and ($3 is null or o.yomi = any($3))
        and ($4 is null or o.owner_user_id = $4)
        and ($5 is null or o.primary_product_id = $5)
        and ($6 is null or o.lead_source_id = $6)
        and ($7 is null or btrim(o.source_detail) = $7)
        and (not $8 or (o.status = 'open' and o.next_action_date is null))
        and (not $9 or (o.status = 'open' and o.last_activity_at < now() - interval '7 day'))
      order by %s %s nulls last
      limit $10 offset $11
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(to_jsonb(f) - 'total' - 'sum_amount' - 'sum_weighted' - 'rn' order by f.rn), '[]'::jsonb),
      'total', coalesce(max(f.total), 0),
      'sum_amount', coalesce(max(f.sum_amount), 0),
      'sum_weighted', coalesce(max(f.sum_weighted), 0)
    ) from f
  $f$, sort_col, dir, sort_col, dir)
  into result
  using v, q, yomi, f_owner, f_product, f_source, f_sd, only_no_next, only_stale, p_limit, p_offset;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'sum_amount', 0, 'sum_weighted', 0));
end $function$;
