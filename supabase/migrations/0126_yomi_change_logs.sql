-- =====================================================================
-- 0126: ヨミ変更履歴（成約分析・失注分析のベースデータ）
--   opportunities.yomi の変更を、どの画面からの変更でもDBトリガーで自動記録する。
--   「0.受注」「6.定期追い」「7.オチ」への変更は要因記入が必要(reason_required)
--   としてマークし、ヨミ変更履歴画面の未記入キューに表示→後から記入できる。
--   記入された要因は 受注→opportunities.win_reason / オチ→lost_reason にも
--   反映し(空のときのみ)、既存の成約/失注分析にそのまま流れる。
-- =====================================================================

create table if not exists public.yomi_change_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  from_yomi text,
  to_yomi text,
  changed_by uuid references auth.users(id),   -- null = システム/バッチ経由
  changed_at timestamptz not null default now(),
  reason text,                                  -- 受注要因 / オチ・定期追いの要因 / 任意メモ
  reason_required boolean not null default false,
  reason_filled_at timestamptz,
  reason_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_yomi_logs_tenant_at on public.yomi_change_logs(tenant_id, changed_at desc);
create index if not exists idx_yomi_logs_opp on public.yomi_change_logs(opportunity_id);
create index if not exists idx_yomi_logs_missing on public.yomi_change_logs(tenant_id) where reason_required and reason is null;
create trigger trg_yomi_logs_updated before update on public.yomi_change_logs
  for each row execute function public.set_updated_at();

alter table public.yomi_change_logs enable row level security;

-- 閲覧: 管理系=全件 / それ以外=自分が変更した行 or 自分担当案件の行
create policy yomi_logs_select on public.yomi_change_logs for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and (changed_by = (select auth.uid())
        or exists (select 1 from opportunities o where o.id = opportunity_id and o.owner_user_id = (select auth.uid()))))
);
-- 要因の記入/編集: 編集ロール かつ (管理系 or 自分の変更 or 自分担当案件)
create policy yomi_logs_update on public.yomi_change_logs for update using (
  tenant_id in (select edit_tenant_ids())
  and (tenant_id in (select view_all_tenant_ids())
    or changed_by = (select auth.uid())
    or exists (select 1 from opportunities o where o.id = opportunity_id and o.owner_user_id = (select auth.uid())))
) with check ( tenant_id in (select edit_tenant_ids()) );
-- 削除: 管理系の編集ロールのみ
create policy yomi_logs_delete on public.yomi_change_logs for delete using (
  tenant_id in (select edit_tenant_ids()) and tenant_id in (select view_all_tenant_ids())
);
-- insert はトリガー(SECURITY DEFINER)経由のみ。ユーザー直接insertのポリシーは設けない

-- ---- 自動記録トリガー(全画面・バッチ共通で漏れなく記録) ----
create or replace function public.log_yomi_change()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.yomi is distinct from old.yomi then
    insert into yomi_change_logs (tenant_id, opportunity_id, from_yomi, to_yomi, changed_by, reason_required)
    values (
      new.tenant_id, new.id, old.yomi, new.yomi, auth.uid(),
      coalesce(new.yomi, '') in ('0.受注', '6.定期追い', '7.オチ')
    );
  end if;
  return new;
end $$;
-- トリガー関数はユーザーが直接EXECUTEする必要がない(発火時の権限チェックはCREATE TRIGGER時)
revoke execute on function public.log_yomi_change() from public, anon, authenticated;

drop trigger if exists trg_opps_yomi_log on public.opportunities;
create trigger trg_opps_yomi_log after update of yomi on public.opportunities
  for each row execute function public.log_yomi_change();
