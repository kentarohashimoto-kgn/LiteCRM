-- 誤登録の取り消しを本人でもできるように、活動削除ポリシーを更新ポリシーと同じ範囲に広げる。
-- (編集ロール かつ (全件閲覧可 または 自分の活動))。管理者/Sales Opsは従来どおり全件削除可。
drop policy if exists activities_del on public.activities;
create policy activities_del on public.activities for delete
  using (
    tenant_id in (select current_tenant_ids())
    and can_edit_role(tenant_id)
    and (can_view_all(tenant_id) or owner_user_id = auth.uid())
  );
