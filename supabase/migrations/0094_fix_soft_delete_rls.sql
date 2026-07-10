-- 論理削除(ゴミ箱行き)が効かない不具合の修正。
--
-- 症状: 「案件を削除」してもゴミ箱に入らず一覧に残り続ける(リード・顧客も同様)。
--
-- 原因: 削除処理は RLS 適用クライアントからの
--        update <table> set deleted_at = now()
--     だが、opps_select / leads_select / accounts_select の各 SELECT ポリシーに
--     「deleted_at is null」が含まれるため、更新後の行(deleted_at がセットされた行)は
--     もはや自分の SELECT ポリシーを満たさない。PostgreSQL はこの更新を
--     「new row violates row-level security policy」として拒否し、deleted_at は
--     結局セットされない = 削除が無かったことになる。
--     (0063 は復元/パージのみ SECURITY DEFINER RPC 化し、初回の論理削除は
--      アプリ側の直接 update のままだったため、実は一度も成功していなかった。)
--
-- 対策: 復元(trash_restore)/パージ(trash_purge)と同様に、論理削除も
--     SECURITY DEFINER RPC 経由にして RLS をバイパスしつつ、関数内で権限を検査する。
--     権限は各テーブルの update USING ポリシー(編集ロール かつ 全件閲覧 or 担当)を踏襲。

create or replace function public.trash_soft_delete(p_kind text, p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if p_kind = 'lead' then
    update leads set deleted_at = now(), deleted_by = auth.uid()
      where id = p_id and tenant_id in (select current_tenant_ids())
        and deleted_at is null and can_edit_role(tenant_id)
        and (can_view_all(tenant_id) or owner_user_id = auth.uid());
  elsif p_kind = 'opportunity' then
    update opportunities set deleted_at = now(), deleted_by = auth.uid()
      where id = p_id and tenant_id in (select current_tenant_ids())
        and deleted_at is null and can_edit_role(tenant_id)
        and (can_view_all(tenant_id) or owner_user_id = auth.uid());
  elsif p_kind = 'account' then
    update accounts set deleted_at = now(), deleted_by = auth.uid()
      where id = p_id and tenant_id in (select current_tenant_ids())
        and deleted_at is null and can_edit_role(tenant_id)
        and (
          can_view_all(tenant_id) or owner_user_id = auth.uid()
          or exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = auth.uid())
        );
  else
    return false;
  end if;
  return found;
end $$;

revoke execute on function public.trash_soft_delete(text, uuid) from public, anon;
grant execute on function public.trash_soft_delete(text, uuid) to authenticated;
