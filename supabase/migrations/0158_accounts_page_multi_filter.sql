-- =====================================================================
-- 顧客一覧の絞り込みを「複数選択」に対応させる。
--   rank / focus / area / industry / owner を配列(JSON array)で受け取り、
--   いずれかに一致する顧客を返す(OR)。従来のスカラー値も後方互換で受理する。
--   例: p_filter = {"rank": ["S","A","B"], "area": ["東京","大阪"]}
-- =====================================================================

-- JSON(配列 or スカラー文字列)を text[] に正規化する補助関数。
-- 空文字・空配列・null・未指定は null を返す(=絞り込みなし)。
create or replace function public.to_text_array(p jsonb)
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then null
    when jsonb_typeof(p) = 'array' then
      (select array_agg(elem) from jsonb_array_elements_text(p) as elem where elem <> '')
    when jsonb_typeof(p) = 'string' then
      (case when nullif(p #>> '{}', '') is null then null else array[p #>> '{}'] end)
    else null
  end;
$$;

create or replace function public.accounts_page(
  p_filter jsonb default '{}'::jsonb,
  p_sort text default 'revenue'::text,
  p_asc boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  -- 各絞り込みを text[] に正規化(配列/スカラー両対応)。null は絞り込みなし。
  f_rank text[] := to_text_array(p_filter->'rank');
  f_focus text[] := to_text_array(p_filter->'focus');
  f_area text[] := to_text_array(p_filter->'area');
  f_industry text[] := to_text_array(p_filter->'industry');
  f_owner text[] := to_text_array(p_filter->'owner');
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
        left join opportunities o on o.account_id = a.id and o.deleted_at is null
        left join profiles p on p.id = a.owner_user_id
      where a.tenant_id = any($1)
        and a.deleted_at is null
        and ($2 is null or a.name ilike '%%' || $2 || '%%')
        and ($3 is null or a.rank = any($3))
        and ($4 is null or a.focus = any($4))
        and ($5 is null or a.area = any($5))
        and ($6 is null or a.industry = any($6))
        and ($7 is null or a.owner_user_id::text = any($7) or ('__none' = any($7) and a.owner_user_id is null))
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
end $function$;

revoke execute on function public.accounts_page(jsonb, text, boolean, int, int) from public, anon;
grant execute on function public.accounts_page(jsonb, text, boolean, int, int) to authenticated;
