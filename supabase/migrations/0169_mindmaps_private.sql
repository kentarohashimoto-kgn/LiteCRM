-- =====================================================================
-- マインドマップを「作成者本人だけ」に限定する
--
--   背景: 当初は owner/admin なら誰でも全マップを閲覧できる設計だったが、
--         Googleカレンダー連携により個人の予定(採用面談・通院・ジム等)が
--         マップに入るようになった。管理者6名に個人の予定が見える状態は不適切。
--
--   変更: 参照・更新とも owner_user_id = auth.uid() に限定する。
--         「管理者だけの機能」であることは admin_tenant_ids() で従来どおり担保し、
--         そのうえで「自分のマップだけ」に絞る(二段構え)。
-- =====================================================================

-- 自分が持っているマップID(SECURITY DEFINER。mindmaps側のRLSと相互再帰しないように)
create or replace function public.my_mindmap_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select id from mindmaps where owner_user_id = auth.uid();
$$;
revoke execute on function public.my_mindmap_ids() from public, anon;
grant execute on function public.my_mindmap_ids() to authenticated;

-- ---- mindmaps: 自分のものだけ ----
drop policy if exists mindmaps_select on public.mindmaps;
drop policy if exists mindmaps_insert on public.mindmaps;
drop policy if exists mindmaps_update on public.mindmaps;
drop policy if exists mindmaps_delete on public.mindmaps;

create policy mindmaps_select on public.mindmaps for select
  using (tenant_id in (select admin_tenant_ids()) and owner_user_id = (select auth.uid()));
create policy mindmaps_insert on public.mindmaps for insert
  with check (tenant_id in (select admin_tenant_ids()) and owner_user_id = (select auth.uid()));
create policy mindmaps_update on public.mindmaps for update
  using (tenant_id in (select admin_tenant_ids()) and owner_user_id = (select auth.uid()))
  with check (tenant_id in (select admin_tenant_ids()) and owner_user_id = (select auth.uid()));
create policy mindmaps_delete on public.mindmaps for delete
  using (tenant_id in (select admin_tenant_ids()) and owner_user_id = (select auth.uid()));

-- ---- ノード・関連線: 自分のマップに属するものだけ ----
do $$
declare t text;
begin
  foreach t in array array['mindmap_nodes','mindmap_links'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
    execute format('create policy %1$s_select on public.%1$s for select using (mindmap_id in (select my_mindmap_ids()));', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (mindmap_id in (select my_mindmap_ids()));', t);
    execute format('create policy %1$s_update on public.%1$s for update using (mindmap_id in (select my_mindmap_ids())) with check (mindmap_id in (select my_mindmap_ids()));', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (mindmap_id in (select my_mindmap_ids()));', t);
  end loop;
end $$;

-- 既存マップの作成者が未設定なら created_by で補う(RLSで見えなくならないように)
update public.mindmaps set owner_user_id = created_by
where owner_user_id is null and created_by is not null;
