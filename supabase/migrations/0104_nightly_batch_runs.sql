-- 方針A(Claude Code方式)の夜間バッチ運用ログ。
-- 各夜間ジョブが「いつ・何を・何件・成否・枠到達・トークン/枠メモ」を1行記録する。
-- 週次のトークン使用実績レビュー(ユーザー要望c)の元データになる。
create table if not exists public.batch_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  job_kind text not null,                    -- 'meeting_summary'|'briefing'|'followup_draft'|'weekly_report'|'weekly_usage_review'|'knowledge_extract' 等
  run_date date not null,                    -- JSTの実行日
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running',    -- 'running'|'success'|'partial'|'error'
  targets_total int not null default 0,      -- 対象件数
  items_generated int not null default 0,    -- 生成成功件数
  items_failed int not null default 0,       -- 失敗件数
  deferred_count int not null default 0,     -- 利用枠のため翌晩へ繰り越した件数
  limit_hit boolean not null default false,  -- サブスク利用枠(5時間/週次)に到達したか
  limit_hit_at timestamptz,                  -- 枠到達を検知した時刻
  usage_note text,                           -- 自己申告のトークン/枠メモ(自由記述)。方針Bへ切替時はai_runsで精密化
  detail jsonb not null default '{}'::jsonb, -- 対象ID・内訳など
  created_by uuid references auth.users(id), -- 夜間バッチはNULL(無人実行)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_batch_runs_tenant_date on public.batch_runs(tenant_id, run_date desc);
create index if not exists idx_batch_runs_tenant_kind_date on public.batch_runs(tenant_id, job_kind, run_date desc);

alter table public.batch_runs enable row level security;

drop policy if exists batch_runs_select on public.batch_runs;
drop policy if exists batch_runs_insert on public.batch_runs;
drop policy if exists batch_runs_update on public.batch_runs;
drop policy if exists batch_runs_delete on public.batch_runs;

create policy batch_runs_select on public.batch_runs for select
  using (tenant_id in (select current_tenant_ids()));
create policy batch_runs_insert on public.batch_runs for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy batch_runs_update on public.batch_runs for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy batch_runs_delete on public.batch_runs for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

drop trigger if exists trg_batch_runs_updated_at on public.batch_runs;
create trigger trg_batch_runs_updated_at before update on public.batch_runs
  for each row execute function public.set_updated_at();
