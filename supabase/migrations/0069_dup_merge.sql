-- B-3 重複検出・マージ:
--   - 顧客: 会社名の正規化(norm_company)一致で重複候補を提示
--   - リード: メールアドレス(lower)一致で重複候補を提示
--   - マージ: 参照FKを動的に列挙して残す側へ付け替え → 重複側を論理削除(ゴミ箱で30日保持)
--     ※ 一意制約に当たるテーブル(例: account_nurture)はスキップし、行は重複側に残す
--     ※ マージ(FK付け替え)自体は元に戻せないため owner/admin のみ実行可

-- ---- 重複候補: 顧客 ----
create or replace function public.dup_candidate_accounts()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  r jsonb;
begin
  with a as (
    select a.id, a.name, a.industry, a.rank, a.created_at, norm_company(a.name) as k,
      (select count(*) from opportunities o where o.account_id = a.id and o.deleted_at is null)::int as opp_count
    from accounts a
    where a.tenant_id = any(v) and a.deleted_at is null
  ),
  g as (
    select k from a where k is not null and k <> ''
    group by k having count(*) > 1
    order by k limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', g.k,
    'items', (select jsonb_agg(to_jsonb(a2) - 'k' order by a2.opp_count desc, a2.created_at) from a a2 where a2.k = g.k)
  ) order by g.k), '[]'::jsonb)
  into r from g;
  return coalesce(r, '[]'::jsonb);
end $$;

-- ---- 重複候補: リード(メール一致) ----
create or replace function public.dup_candidate_leads()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  r jsonb;
begin
  with l as (
    select l.id, l.company_name, l.contact_name, l.email, l.raw_event, l.rank, l.acquired_at, l.created_at,
      lower(l.email) as k,
      (select count(*) from opportunities o where o.lead_id = l.id and o.deleted_at is null)::int as opp_count
    from leads l
    where l.tenant_id = any(v) and l.deleted_at is null and coalesce(l.email, '') <> ''
  ),
  g as (
    select k from l group by k having count(*) > 1
    order by k limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', g.k,
    'items', (select jsonb_agg(to_jsonb(l2) - 'k' order by l2.opp_count desc, l2.acquired_at nulls last, l2.created_at) from l l2 where l2.k = g.k)
  ) order by g.k), '[]'::jsonb)
  into r from g;
  return coalesce(r, '[]'::jsonb);
end $$;

-- ---- マージ共通: 指定テーブルを参照する全FK列を primary へ付け替える ----
create or replace function public.fn_repoint_fks(p_target regclass, p_primary uuid, p_dups uuid[])
returns integer
language plpgsql
set search_path = public
as $$
declare
  rec record;
  moved int;
  total int := 0;
begin
  for rec in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.confrelid = p_target and c.contype = 'f'
      and c.conrelid <> p_target
  loop
    begin
      execute format('update %s set %I = $1 where %I = any($2)', rec.tbl, rec.col, rec.col)
        using p_primary, p_dups;
      get diagnostics moved = row_count;
      total := total + moved;
    exception when unique_violation or foreign_key_violation then
      null; -- 一意制約等に当たるテーブルはスキップ(行は重複側に残る)
    end;
  end loop;
  return total;
end $$;

-- ---- 顧客マージ ----
create or replace function public.merge_accounts(p_primary uuid, p_dups uuid[])
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  dups uuid[];
  moved int;
begin
  if not exists (
    select 1 from accounts
    where id = p_primary and tenant_id = any(v) and deleted_at is null
      and current_role_in(tenant_id) in ('owner','admin')
  ) then
    return jsonb_build_object('ok', false, 'error', '権限がないか、マージ先の顧客が見つかりません');
  end if;
  dups := array(
    select id from accounts
    where id = any(p_dups) and id <> p_primary and tenant_id = any(v) and deleted_at is null
  );
  if coalesce(array_length(dups, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'マージ対象がありません');
  end if;

  moved := fn_repoint_fks('public.accounts'::regclass, p_primary, dups);
  update accounts set deleted_at = now(), deleted_by = auth.uid() where id = any(dups);
  return jsonb_build_object('ok', true, 'moved', moved, 'merged', array_length(dups, 1));
end $$;

-- ---- リードマージ ----
create or replace function public.merge_leads(p_primary uuid, p_dups uuid[])
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  dups uuid[];
  moved int;
begin
  if not exists (
    select 1 from leads
    where id = p_primary and tenant_id = any(v) and deleted_at is null
      and current_role_in(tenant_id) in ('owner','admin')
  ) then
    return jsonb_build_object('ok', false, 'error', '権限がないか、マージ先のリードが見つかりません');
  end if;
  dups := array(
    select id from leads
    where id = any(p_dups) and id <> p_primary and tenant_id = any(v) and deleted_at is null
  );
  if coalesce(array_length(dups, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'マージ対象がありません');
  end if;

  moved := fn_repoint_fks('public.leads'::regclass, p_primary, dups);
  update leads set deleted_at = now(), deleted_by = auth.uid() where id = any(dups);
  return jsonb_build_object('ok', true, 'moved', moved, 'merged', array_length(dups, 1));
end $$;

-- ---- 実行権限 ----
revoke execute on function public.dup_candidate_accounts() from public, anon;
grant execute on function public.dup_candidate_accounts() to authenticated;
revoke execute on function public.dup_candidate_leads() from public, anon;
grant execute on function public.dup_candidate_leads() to authenticated;
-- fn_repoint_fks は内部用(直接実行不可)
revoke execute on function public.fn_repoint_fks(regclass, uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.merge_accounts(uuid, uuid[]) from public, anon;
grant execute on function public.merge_accounts(uuid, uuid[]) to authenticated;
revoke execute on function public.merge_leads(uuid, uuid[]) from public, anon;
grant execute on function public.merge_leads(uuid, uuid[]) to authenticated;
