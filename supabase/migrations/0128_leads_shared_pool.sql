-- =====================================================================
-- 0128: リードを「チーム共有の架電プール」にする
--   リード(展示会/セミナーの獲得リスト)は特定営業の所有物ではなく、
--   チームで架電・アポ獲得する共有リスト。だが従来ポリシーは
--   「管理系=全件 / それ以外=owner が自分のリードのみ」で、
--   全リードが owner=NULL のため Sales(sales_rep/external_sales)には
--   1件も見えず、アポ登録の「リードから検索」で候補が出なかった。
--   さらにアポ獲得時の disposition 更新(重複架電防止)も owner 不一致で
--   失敗していた。
--
--   対応: リードの閲覧・更新を「管理系＋営業系(編集ロール)の共有プール」にする。
--   - 閲覧: view_all(owner/admin/sales_manager/viewer) OR edit(＋sales_rep/external_sales)
--   - 更新: 編集ロール(edit_tenant_ids)は共有プールのリードを更新可
--   - 追加/削除ポリシーは不変(作成=編集ロール / 物理削除=owner/admin)
--   意味の広がりは「Sales系がプールを扱える」加算のみ。viewerは読取のまま、
--   partnerは従来どおり対象外(いずれも既存の可視範囲を縮小しない)。
-- =====================================================================

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (
  (deleted_at is null) and (
    tenant_id in (select view_all_tenant_ids())
    or tenant_id in (select edit_tenant_ids())
  )
);

drop policy if exists leads_upd on public.leads;
create policy leads_upd on public.leads for update using (
  tenant_id in (select edit_tenant_ids())
) with check (
  tenant_id in (select edit_tenant_ids())
);
