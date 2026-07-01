-- セキュリティ強化: Supabase Database Linter 警告への対応
-- (1) バックアップ3テーブルのRLS未有効(ERROR: rls_disabled_in_public)を解消
-- (2) 一部関数の search_path 未設定(WARN)を解消
-- (3) 破壊的/分析RPCの anon 実行権限を剥奪(WARN: anon_security_definer_function_executable)
-- ※ すべて追加的・非破壊。アプリは authenticated ロールで動作するため影響なし。

-- ============================================================
-- (1) バックアップテーブルのRLS有効化 + 公開ロールの権限剥奪
--     _bk_* は Notion取込前スナップショット。復旧はSQL Editor(service_role)で行うため
--     ポリシーは付与せず「deny-all(service_roleのみ)」とする。
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    '_bk_opportunities_prenotionsync',
    '_bk_meetings_prenotionsync',
    '_bk_billing_schedules_prenotionsync'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ============================================================
-- (2) 関数 search_path を固定(mutable search_path の解消)
-- ============================================================
alter function public.norm_company(text)                 set search_path = public, pg_temp;
alter function public.engagement_rank_of(integer)        set search_path = public, pg_temp;
alter function public.lead_metrics()                     set search_path = public, pg_temp;
alter function public.workspace_lite()                   set search_path = public, pg_temp;
alter function public.workspace_full()                   set search_path = public, pg_temp;
alter function public.sales_actuals(date, date)          set search_path = public, pg_temp;
alter function public.size_band(text)                    set search_path = public, pg_temp;

-- ============================================================
-- (3) SECURITY DEFINER RPC の anon 実行権限を剥奪
--     関数は既定で EXECUTE が PUBLIC に付与されるため、PUBLIC から revoke し
--     authenticated へ明示 grant する(anonのみ排除、アプリは維持)。
--     破壊的RPC(purge/recompute)と分析RPCを anon から呼べないようにする。
--     ※ current_tenant_ids / current_role_in はRLSポリシー評価で全ロールが参照するため対象外。
-- ============================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.channel_roi(date, date)',
    'public.channel_level_matrix(date, date)',
    'public.exhibition_breakdown(date, date)',
    'public.exhibition_deal_roi(date, date)',
    'public.product_profitability(date, date)',
    'public.subscription_metrics(date, date)',
    'public.seminar_followup(text)',
    'public.purge_tenant_opportunities()',
    'public.recompute_engagement(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
