-- 0170_attachments_select_scope.sql
-- セキュリティ是正(包括レビュー2026-07-26 P1):
--   attachments_select がテナント全員に閲覧を許していたため、
--   採用候補者(candidate)の書類や担当外の商談/顧客の添付が越権閲覧できた。
--   insert/delete は 0138 で target 種別ごとに絞られていたが、SELECT だけ据置。
-- 本修正: SELECT を target 種別に応じてスコープする。
--   - candidate  : is_hr(=hr/owner/admin) または本人(uploaded_by)
--   - opportunity: 当該商談が閲覧可能な場合のみ(opportunities の RLS を EXISTS で継承)
--   - account    : 当該顧客が閲覧可能な場合のみ(accounts の RLS を EXISTS で継承)
-- 備考: EXISTS 内の副問い合わせは呼び出しユーザー権限で評価されるため、
--   opportunities/accounts の owner/view_all スコープがそのまま効く。
--   本番の attachments は現状0行のため、既存データへの影響はない。

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select
  using (
    tenant_id in (select current_tenant_ids())
    and (
      case target_type
        when 'candidate' then (is_hr(tenant_id) or uploaded_by = (select auth.uid()))
        when 'opportunity' then exists (
          select 1 from public.opportunities o where o.id = attachments.target_id
        )
        when 'account' then exists (
          select 1 from public.accounts a where a.id = attachments.target_id
        )
        else false
      end
    )
  );

-- ロールバック(down):
--   drop policy if exists attachments_select on public.attachments;
--   create policy attachments_select on public.attachments for select
--     using (tenant_id in (select current_tenant_ids()));
