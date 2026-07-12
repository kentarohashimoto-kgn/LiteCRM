-- 週次報告のスナップショット(型化・保存・過去参照・2世代比較)。
-- 週次レビューの主要数値を payload(jsonb) に丸ごと保存し、過去分を同じ見た目で再現・比較する。
-- xray_snapshots と同じ設計方針。
create table if not exists public.weekly_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid references auth.users(id), -- null=全社ビュー。将来の営業マン別スナップ用
  week_start date not null,                     -- 対象週(月曜)
  label text,
  note text,
  payload jsonb not null,                       -- 主要数値の丸ごと(目標/着地/パイプライン/担当別 等)
  taken_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_weekly_snap_tenant on public.weekly_report_snapshots(tenant_id, week_start desc, taken_at desc);

alter table public.weekly_report_snapshots enable row level security;

drop policy if exists weekly_snap_select on public.weekly_report_snapshots;
drop policy if exists weekly_snap_insert on public.weekly_report_snapshots;
drop policy if exists weekly_snap_update on public.weekly_report_snapshots;
drop policy if exists weekly_snap_delete on public.weekly_report_snapshots;

create policy weekly_snap_select on public.weekly_report_snapshots for select
  using (tenant_id in (select current_tenant_ids()));
create policy weekly_snap_insert on public.weekly_report_snapshots for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy weekly_snap_update on public.weekly_report_snapshots for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy weekly_snap_delete on public.weekly_report_snapshots for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
