-- 性能改善: 顧客一覧のサーバーページング＋集計。案件の突合(累計売上/進行中見込)もSQL側で実施。
-- 従来は全案件(1.3MB)を取得しクライアントで顧客×案件を集計しており、件数増でタイムアウトしていた。
create or replace function public.accounts_page(
  p_filter jsonb default '{}'::jsonb,
  p_sort text default 'revenue',
  p_asc boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  f_rank text := nullif(p_filter->>'rank', '');
  f_focus text := nullif(p_filter->>'focus', '');
  f_area text := nullif(p_filter->>'area', '');
  f_industry text := nullif(p_filter->>'industry', '');
  f_owner text := nullif(p_filter->>'owner', '');
  f_active text := nullif(p_filter->>'active', '');
  sort_expr text := case p_sort
    when 'openAmount' then 'open_amount'
    when 'oppCount' then 'opp_count'
    when 'name' then 'name'
    when 'rank' then 'rank_order'
    else 'lifetime_revenue' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with agg as (
      select a.id, a.name, a.industry, a.area, a.status, a.rank, a.focus, a.owner_user_id,
        coalesce(p.display_name, p.email, '—') as owner_name,
        coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as lifetime_revenue,
        coalesce(sum(o.amount) filter (where o.status = 'open'), 0) as open_amount,
        count(o.id) as opp_count,
        (count(o.id) filter (where o.status = 'open')) > 0 as is_active,
        case a.rank when 'S' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'dormant' then 4 else 9 end as rank_order
      from accounts a
        left join opportunities o on o.account_id = a.id
        left join profiles p on p.id = a.owner_user_id
      where a.tenant_id = any($1)
        and ($2 is null or a.name ilike '%%' || $2 || '%%')
        and ($3 is null or a.rank = $3)
        and ($4 is null or a.focus = $4)
        and ($5 is null or a.area = $5)
        and ($6 is null or a.industry = $6)
        and ($7 is null or ($7 = '__none' and a.owner_user_id is null) or a.owner_user_id::text = $7)
      group by a.id, p.display_name, p.email
    ),
    filt as (
      select *, count(*) over() as total, row_number() over(order by %s %s nulls last, name asc) as rn
      from agg
      where ($8 is null or ($8 = 'active' and is_active) or ($8 = 'inactive' and not is_active))
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(to_jsonb(filt) - 'total' - 'rn' - 'rank_order' order by rn) filter (where rn > $9 and rn <= $9 + $10), '[]'::jsonb),
      'total', coalesce(max(total), 0)
    ) from filt
  $f$, sort_expr, dir)
  into result
  using v, q, f_rank, f_focus, f_area, f_industry, f_owner, f_active, p_offset, p_limit;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0));
end $$;

revoke execute on function public.accounts_page(jsonb, text, boolean, int, int) from public, anon;
grant execute on function public.accounts_page(jsonb, text, boolean, int, int) to authenticated;
