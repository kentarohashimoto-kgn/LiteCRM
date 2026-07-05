-- E-1 残存ページ軽量化: 活動履歴のサーバーページング。
-- 従来は workspace_full(2.1MB)を取得して先頭80件表示 → ページ分のみ取得(名前解決込み)に変更。
-- 可視性はRLSと同等: 全件閲覧ロール or 自分の活動 or 自分が担当する案件の活動。
create or replace function public.activities_page(
  p_filter jsonb default '{}'::jsonb,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with f as (
    select act.id, act.activity_type, act.title, act.body, act.activity_at,
      act.owner_user_id, coalesce(p.display_name, p.email, '—') as owner_name, p.avatar_color as owner_color,
      act.opportunity_id, o.name as opportunity_name,
      act.account_id, coalesce(a.name, oa.name) as account_name,
      count(*) over() as total
    from activities act
      left join profiles p on p.id = act.owner_user_id
      left join opportunities o on o.id = act.opportunity_id
      left join accounts a on a.id = act.account_id
      left join accounts oa on oa.id = o.account_id
    where act.tenant_id in (select current_tenant_ids())
      and (
        can_view_all(act.tenant_id)
        or act.owner_user_id = auth.uid()
        or (o.id is not null and o.owner_user_id = auth.uid())
      )
      -- ゴミ箱入りの案件/顧客に紐づく活動は出さない
      and (act.opportunity_id is null or o.deleted_at is null)
      and (act.account_id is null or a.deleted_at is null)
      and (nullif(p_filter->>'owner','') is null or act.owner_user_id = (p_filter->>'owner')::uuid)
      and (nullif(p_filter->>'type','') is null or act.activity_type = p_filter->>'type')
      and (nullif(p_filter->>'q','') is null
           or act.title ilike '%' || (p_filter->>'q') || '%'
           or act.body ilike '%' || (p_filter->>'q') || '%'
           or o.name ilike '%' || (p_filter->>'q') || '%'
           or coalesce(a.name, oa.name) ilike '%' || (p_filter->>'q') || '%')
    order by act.activity_at desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(to_jsonb(f) - 'total' order by f.activity_at desc), '[]'::jsonb),
    'total', coalesce(max(f.total), 0)
  ) from f;
$$;

revoke execute on function public.activities_page(jsonb, int, int) from public, anon;
grant execute on function public.activities_page(jsonb, int, int) to authenticated;
