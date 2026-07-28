-- 0170 の create or replace で can_edit_role の search_path 固定(0006/0112相当)が外れたため再設定。
-- 新設の can_view_sales_numbers も同様に固定する(セキュリティアドバイザ指摘対応)。
alter function public.can_edit_role(uuid) set search_path = public, pg_temp;
alter function public.can_view_sales_numbers(uuid) set search_path = public, pg_temp;
