-- 営業マン別 週報のナラティブ入力(自動集計は既存データから算出し、コメント/予定のみ保存)。
-- 1営業マン×1週で1行。upsertで上書き。本人は自分の週報を保存可、管理職は全員分。
create table if not exists public.weekly_rep_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  week_start date not null,                -- 対象週(月曜)
  last_week_comment text,                  -- 先週の実績・差分コメント
  next_week_plan text,                     -- 来週の予定
  month_ahead_plan text,                   -- 1ヶ月先までの行動予定・想定工数
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, owner_user_id, week_start)
);

create index if not exists idx_rep_report_tenant on public.weekly_rep_reports(tenant_id, week_start desc, owner_user_id);

alter table public.weekly_rep_reports enable row level security;

drop policy if exists rep_report_select on public.weekly_rep_reports;
drop policy if exists rep_report_insert on public.weekly_rep_reports;
drop policy if exists rep_report_update on public.weekly_rep_reports;
drop policy if exists rep_report_delete on public.weekly_rep_reports;

create policy rep_report_select on public.weekly_rep_reports for select
  using (tenant_id in (select current_tenant_ids()));
-- 本人 or 編集権限(管理職)が書込可
create policy rep_report_insert on public.weekly_rep_reports for insert
  with check (tenant_id in (select current_tenant_ids()) and (owner_user_id = auth.uid() or can_edit_role(tenant_id)));
create policy rep_report_update on public.weekly_rep_reports for update
  using (tenant_id in (select current_tenant_ids()) and (owner_user_id = auth.uid() or can_edit_role(tenant_id)));
create policy rep_report_delete on public.weekly_rep_reports for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

drop trigger if exists trg_rep_report_updated_at on public.weekly_rep_reports;
create trigger trg_rep_report_updated_at before update on public.weekly_rep_reports
  for each row execute function public.set_updated_at();
