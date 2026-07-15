-- 商談の録音（ブラウザ録音→保存→夜間バッチで文字起こし/要約する土台）。
-- フェーズ1: 録音の保存＋処理キュー。フェーズ2で transcript/summary を夜間バッチが埋める。
-- 音声実体は非公開バケット recordings に置き、30日で自動削除（expires_at）。
create table if not exists public.meeting_recordings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  meeting_id uuid references public.meetings(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  owner_user_id uuid not null,                 -- 録音者
  title text,
  storage_path text,                           -- recordings バケット内のパス
  mime_type text,
  duration_sec integer,
  size_bytes bigint,
  -- recording=録音中 / uploaded=保存済み(処理待ち) / transcribing=処理中 / done=完了 / failed=失敗
  status text not null default 'recording',
  transcript text,
  transcript_source text,                      -- whisper / tldv
  summary text,
  error text,
  expires_at timestamptz,                       -- 音声の自動削除目標（30日）
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_mrec_meeting on public.meeting_recordings(meeting_id);
create index if not exists idx_mrec_opp on public.meeting_recordings(opportunity_id);
-- 夜間バッチの取得用（未処理を古い順に）
create index if not exists idx_mrec_queue on public.meeting_recordings(tenant_id, status, created_at);

drop trigger if exists trg_mrec_updated on public.meeting_recordings;
create trigger trg_mrec_updated before update on public.meeting_recordings
  for each row execute function public.set_updated_at();

alter table public.meeting_recordings enable row level security;

-- 参照: テナント内で全件閲覧ロール、または録音者/親案件担当
drop policy if exists mrec_select on public.meeting_recordings;
create policy mrec_select on public.meeting_recordings for select
  using (
    tenant_id in (select current_tenant_ids()) and (
      can_view_all(tenant_id)
      or owner_user_id = auth.uid()
      or exists (select 1 from public.opportunities o where o.id = meeting_recordings.opportunity_id and o.owner_user_id = auth.uid())
    )
  );
drop policy if exists mrec_insert on public.meeting_recordings;
create policy mrec_insert on public.meeting_recordings for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists mrec_update on public.meeting_recordings;
create policy mrec_update on public.meeting_recordings for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists mrec_delete on public.meeting_recordings;
create policy mrec_delete on public.meeting_recordings for delete
  using (tenant_id in (select current_tenant_ids()) and (owner_user_id = auth.uid() or current_role_in(tenant_id) in ('owner','admin')));

-- 非公開バケット（音声実体）。アクセスはサーバー(service role)の署名URLのみ。
insert into storage.buckets (id, name, public, file_size_limit)
values ('recordings', 'recordings', false, 314572800)  -- 300MB/ファイル上限
on conflict (id) do nothing;
