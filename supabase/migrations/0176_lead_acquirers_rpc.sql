-- =====================================================================
-- 0176: リードの社内担当者(取得担当 acquirer)の選択肢を名寄せして返すRPC。
--   実データには表記ゆれ(「平石　真子」全角/「平石 真子」半角)や端末番号が混在するため、
--   ①acquirer_aliases の別名を優先 ②空白除去で正規化 して1人にまとめる。
--   返り値に raws(元の値の配列)を含め、フィルタ時はこれを IN 展開して使う。
-- =====================================================================

create or replace function public.lead_acquirers()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      l.acquirer as raw,
      -- 別名があればそれ、無ければ元の値。表示は空白を1つに畳む
      coalesce(nullif(a.display_name, ''), l.acquirer) as disp
    from leads l
    left join acquirer_aliases a on a.raw = l.acquirer and a.tenant_id = l.tenant_id
    where l.tenant_id in (select current_tenant_ids())
      and coalesce(l.acquirer, '') <> ''
  ),
  norm as (
    select raw, disp,
      -- 名寄せキー: 全角/半角スペースを除去
      regexp_replace(disp, '[[:space:]　]', '', 'g') as key
    from base
  ),
  grouped as (
    select key,
      -- 表示名は最頻出の表記を採用
      (array_agg(disp order by cnt desc))[1] as name,
      array_agg(distinct raw) as raws,
      sum(cnt)::int as leads
    from (select key, disp, raw, count(*)::int as cnt from norm group by key, disp, raw) x
    group by key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', name, 'raws', to_jsonb(raws), 'leads', leads
  ) order by leads desc), '[]'::jsonb)
  from grouped
$$;
revoke execute on function public.lead_acquirers() from public, anon;
grant execute on function public.lead_acquirers() to authenticated;
