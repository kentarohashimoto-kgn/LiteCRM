-- 全置換用: テナントの全案件と依存子を安全に消す(請求/タスク/活動はopportunity_idをNULL化して保全)。
-- 商談CSV全置換インポートからのみ呼ぶ。バックアップ前提。
-- ロールバック: drop function purge_tenant_opportunities();
create or replace function public.purge_tenant_opportunities()
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v uuid[];
begin
  v := array(select current_tenant_ids());
  if v is null or array_length(v,1) is null then return; end if;
  if not can_edit_role(v[1]) then return; end if;
  update billing_schedules set opportunity_id = null where tenant_id = any(v);
  update tasks set opportunity_id = null where tenant_id = any(v);
  update activities set opportunity_id = null where tenant_id = any(v);
  delete from opportunity_products where tenant_id = any(v);
  delete from stage_histories where opportunity_id in (select id from opportunities where tenant_id = any(v));
  delete from opportunity_change_logs where opportunity_id in (select id from opportunities where tenant_id = any(v));
  update opportunity_review_extensions set existing_opportunity_id = null
    where existing_opportunity_id in (select id from opportunities where tenant_id = any(v));
  delete from meetings where tenant_id = any(v);
  delete from opportunities where tenant_id = any(v);
end;
$function$;
