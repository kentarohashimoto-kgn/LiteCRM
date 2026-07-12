-- =====================================================================
-- 0124: AIバッチのスタート/停止をアプリ側で制御する
--   batch_job_settings: ジョブ(job_kind)ごとの enabled フラグと停止理由。
--   実行経路(F1 ingest API・夜間Claude Codeセッションのrunbook)は
--   実行前に必ずこの設定を確認し、停止中は何もしない。
--   初期値: meeting_summary=稼働 / na_task_draft=停止 /
--           content_draft=停止(記事品質の改善まで停止・2026-07-12 指示)
-- =====================================================================

create table if not exists public.batch_job_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  job_kind text not null,
  label text not null,
  description text,
  enabled boolean not null default false,
  note text,                                -- 停止理由・運用メモ
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_batch_job_settings on public.batch_job_settings(tenant_id, job_kind);
create trigger trg_batch_job_settings_updated before update on public.batch_job_settings
  for each row execute function public.set_updated_at();

alter table public.batch_job_settings enable row level security;

-- 閲覧: テナントメンバー全員(運用ダッシュボードで状態を見せる)
create policy batch_job_settings_select on public.batch_job_settings for select using (
  tenant_id in (select current_tenant_ids())
);
-- 変更: owner/admin のみ
create policy batch_job_settings_update on public.batch_job_settings for update using (
  tenant_id in (select tenant_id from memberships
    where user_id = (select auth.uid()) and status = 'active' and role in ('owner','admin'))
) with check (
  tenant_id in (select tenant_id from memberships
    where user_id = (select auth.uid()) and status = 'active' and role in ('owner','admin'))
);

-- 初期データ
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'meeting_summary', '議事録AI要約（夜間）',
   '未要約の商談議事録（直近7日）をAIが要約して確認キューへ。最大10件/晩。', true, null),
  ('00000000-0000-0000-0000-000000000001', 'na_task_draft', 'ネクストアクション下書き',
   '議事録要約からNAタスク案を下書き生成（確認キュー行き）。', false, '疎通確認後に有効化予定'),
  ('00000000-0000-0000-0000-000000000001', 'content_draft', 'AI記事作成（ブログ）',
   '選定済みの記事ネタからSEO記事ドラフトを生成（1日最大5本）。', false, '記事品質の改善まで停止（2026-07-12 指示）')
on conflict (tenant_id, job_kind) do nothing;
