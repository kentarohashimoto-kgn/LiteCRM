-- =====================================================================
-- 書き込みポリシーの分割(SELECT 漏れの修正)
--
-- `FOR ALL` ポリシーは USING 句が SELECT にも適用されるため、読み取りスコープが
-- tenant 全体より狭いテーブル(accounts/contacts/leads/opportunities/tasks/
-- activities/opportunity_products)では、外部営業に全顧客リスト等が見えてしまう
-- (要件 11.2 違反)。
-- 対策: write を INSERT/UPDATE/DELETE に分割し、SELECT は *_select のみで制御する。
-- =====================================================================

-- accounts
drop policy if exists accounts_write on accounts;
create policy accounts_ins on accounts for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy accounts_upd on accounts for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
    and (can_view_all(tenant_id) or owner_user_id = auth.uid()
         or exists (select 1 from opportunities o where o.account_id = accounts.id and o.owner_user_id = auth.uid())))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy accounts_del on accounts for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- contacts
drop policy if exists contacts_write on contacts;
create policy contacts_ins on contacts for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy contacts_upd on contacts for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
    and (can_view_all(tenant_id)
         or exists (select 1 from opportunities o where o.account_id = contacts.account_id and o.owner_user_id = auth.uid())))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy contacts_del on contacts for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- leads
drop policy if exists leads_write on leads;
create policy leads_ins on leads for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy leads_upd on leads for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
    and (can_view_all(tenant_id) or owner_user_id = auth.uid()))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy leads_del on leads for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- opportunities
drop policy if exists opps_write on opportunities;
create policy opps_ins on opportunities for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy opps_upd on opportunities for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
    and (can_view_all(tenant_id) or owner_user_id = auth.uid()))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy opps_del on opportunities for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- tasks
drop policy if exists tasks_write on tasks;
create policy tasks_ins on tasks for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy tasks_upd on tasks for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
    and (can_view_all(tenant_id) or assigned_to = auth.uid() or created_by = auth.uid()))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy tasks_del on tasks for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- activities
drop policy if exists activities_write on activities;
create policy activities_ins on activities for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy activities_upd on activities for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
    and (can_view_all(tenant_id) or owner_user_id = auth.uid()))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy activities_del on activities for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- opportunity_products
drop policy if exists opp_products_write on opportunity_products;
create policy opp_products_ins on opportunity_products for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy opp_products_upd on opportunity_products for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy opp_products_del on opportunity_products for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
