-- =====================================================================
-- 0127: アポ獲得者の可視化(内勤→外勤の割り当てフロー対応)
--   内勤(インサイドセールス/外部営業)がアポを獲得し、営業担当を別の外勤に
--   割り当てると、案件owner=外勤 になり、獲得者本人は自分が登録した案件・顧客を
--   閲覧できなかった(RETURNINGで作成も失敗。作成側はアプリで別途対応済み)。
--   opportunities.appt_acquired_by = 自分 の案件と、その案件に紐づく顧客を
--   閲覧できるように SELECTポリシーを「加算的に」広げる(既存の可視範囲は不変)。
-- =====================================================================

-- 案件: 自分がアポ獲得した案件を閲覧可に
drop policy if exists opps_select on public.opportunities;
create policy opps_select on public.opportunities for select using (
  (deleted_at is null) and (
    tenant_id in (select view_all_tenant_ids())
    or (tenant_id in (select current_tenant_ids())
        and (owner_user_id = (select auth.uid()) or appt_acquired_by = (select auth.uid())))
  )
);

-- 顧客: 自分がアポ獲得した案件が紐づく顧客も閲覧可に
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select using (
  (deleted_at is null) and (
    tenant_id in (select view_all_tenant_ids())
    or (tenant_id in (select current_tenant_ids())
        and (owner_user_id = (select auth.uid())
          or exists (select 1 from opportunities o
            where o.account_id = accounts.id
              and (o.owner_user_id = (select auth.uid()) or o.appt_acquired_by = (select auth.uid())))))
  )
);
