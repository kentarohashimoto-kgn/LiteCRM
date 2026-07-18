-- =====================================================================
-- WO-21: メールシーケンス(追客カデンス) — F-101b
--   「Day0お礼 → Day3資料 → Day7再打診」のような多段フォローを定義し、案件/担当者を
--   投入(enroll)すると、日次cronが「今日送るべきステップ」を本人アカウント(WO-22の
--   SMTP送信基盤)から送信する。返信は現状受信同期が無いため停止条件は
--   受注/失注/アポ化(検知可能なもの)で自動停止する。送信は WO-22 と同じ経路=
--   本人のSentにも残り、開封/クリックも計測される。
--
--   加算的スキーマ。全テーブル tenant_id + RLS + set_updated_at。
-- =====================================================================

-- ---- シーケンス定義 ----
create table if not exists public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',      -- 'active'|'archived'
  steps jsonb not null default '[]'::jsonb,    -- [{ wait_days:int, template_id:uuid }...] 先頭から順に送信
  stop_on jsonb not null default '{"on_won":true,"on_lost":true,"on_appointment":false}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_email_sequences_tenant on public.email_sequences(tenant_id, status);
create trigger trg_email_sequences_updated before update on public.email_sequences
  for each row execute function public.set_updated_at();

alter table public.email_sequences enable row level security;
drop policy if exists email_sequences_select on public.email_sequences;
create policy email_sequences_select on public.email_sequences for select
  using (tenant_id in (select current_tenant_ids()));
drop policy if exists email_sequences_insert on public.email_sequences;
create policy email_sequences_insert on public.email_sequences for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists email_sequences_update on public.email_sequences;
create policy email_sequences_update on public.email_sequences for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists email_sequences_delete on public.email_sequences;
create policy email_sequences_delete on public.email_sequences for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- 案件/担当者ごとの進行状態 ----
create table if not exists public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sequence_id uuid not null references email_sequences(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete cascade,
  to_addr text not null,
  status text not null default 'active',       -- 'active'|'completed'|'stopped'
  current_step int not null default 0,          -- 次に送るステップの0始まりインデックス
  next_due_date date,                           -- この日以降にcronが次ステップを送信
  stopped_reason text,
  enrolled_by uuid not null references auth.users(id),  -- 送信に使うメールアカウントの持ち主
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 同一シーケンス×同一宛先の二重投入を防ぐ(active時)。
create unique index if not exists uq_seq_enroll_active
  on public.sequence_enrollments(sequence_id, to_addr) where status = 'active';
create index if not exists idx_seq_enroll_due on public.sequence_enrollments(status, next_due_date);
create index if not exists idx_seq_enroll_tenant on public.sequence_enrollments(tenant_id, status);
create trigger trg_seq_enroll_updated before update on public.sequence_enrollments
  for each row execute function public.set_updated_at();

alter table public.sequence_enrollments enable row level security;
-- 参照: 管理系=全件 / それ以外=自分が投入 or 自分担当案件
drop policy if exists seq_enroll_select on public.sequence_enrollments;
create policy seq_enroll_select on public.sequence_enrollments for select using (
  tenant_id in (select view_all_tenant_ids())
  or (tenant_id in (select current_tenant_ids())
      and (enrolled_by = (select auth.uid())
        or exists (select 1 from opportunities o where o.id = opportunity_id and o.owner_user_id = (select auth.uid()))))
);
drop policy if exists seq_enroll_insert on public.sequence_enrollments;
create policy seq_enroll_insert on public.sequence_enrollments for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id) and enrolled_by = (select auth.uid()));
drop policy if exists seq_enroll_update on public.sequence_enrollments;
create policy seq_enroll_update on public.sequence_enrollments for update using (
  tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
  and (enrolled_by = (select auth.uid()) or tenant_id in (select view_all_tenant_ids()))
) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists seq_enroll_delete on public.sequence_enrollments;
create policy seq_enroll_delete on public.sequence_enrollments for delete using (
  tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
  and (enrolled_by = (select auth.uid()) or tenant_id in (select view_all_tenant_ids()))
);

-- ---- email_messages にシーケンス由来の紐付けを追加 ----
alter table public.email_messages
  add column if not exists sequence_enrollment_id uuid references sequence_enrollments(id) on delete set null,
  add column if not exists sequence_step int;
create index if not exists idx_email_messages_seq on public.email_messages(sequence_enrollment_id, sequence_step);

-- ---- シーケンス送信ジョブの停止スイッチ ----
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'email_sequences', 'メールシーケンス(追客カデンス)',
   '有効な投入(enrollment)の当日ステップを本人アカウント経由で自動送信。停止中は送信しない。', true, null)
on conflict (tenant_id, job_kind) do nothing;
