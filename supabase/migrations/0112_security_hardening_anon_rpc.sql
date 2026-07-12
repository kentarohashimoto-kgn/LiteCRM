-- セキュリティ監査(2026-07-12)対応①: anon(未ログイン)から実行可能なSECURITY DEFINER関数を封鎖。
-- 過去の0040/0041で対策済みのパターンが、以降に追加されたRPC/トリガ関数で再発していた。
-- PUBLICデフォルト権限が残ると anon の revoke だけでは消えないため、public と anon の両方から剥奪する。
-- authenticated の実行権は維持(アプリの正規経路)。
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'current_role_in','current_tenant_ids','dashboard_month_series',
        'enforce_owner_reassign','exhibition_campaign_lead_stats','exhibition_campaign_stats',
        'exhibition_opps','exhibition_untouched_leads','fn_audit_row',
        'fn_fu_on_opportunity_won','fn_fu_seed_case','opp_source_details','xray_metrics'
      )
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
  end loop;
end $$;

-- 今後の新規関数にPUBLIC実行権が自動付与されないようにする(再発防止)。
-- 注意: 以後の新規RPCは migration 内で明示的に `grant execute ... to authenticated` が必要(GUARDRAILS準拠)。
alter default privileges in schema public revoke execute on functions from public, anon;

-- search_path未固定の関数を修正
alter function public.is_project_mgr(uuid) set search_path = public, pg_temp;
