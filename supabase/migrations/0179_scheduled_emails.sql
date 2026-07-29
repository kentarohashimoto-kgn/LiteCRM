-- =====================================================================
-- 0179: メールの予約送信（Gmailの「送信日時を設定」相当）
--   作成時に送らず内容を保持し、指定時刻に cron が本人アカウントで送信する。
--   実配信・計測は既存の deliverTrackedEmail に委譲するため、送信結果は
--   通常送信とまったく同じ（開封/クリック計測・配信停止フッター・履歴）。
--   資格情報は保持せず、送信時に user_mail_accounts から復号する
--   （シーケンスcronと同じ方式）。
-- =====================================================================

create table if not exists public.scheduled_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  scheduled_at timestamptz not null,               -- 送信予定時刻(UTC保持・UIはJST)
  status text not null default 'scheduled',        -- 'scheduled'|'sent'|'canceled'|'failed'
  sender_user_id uuid not null references auth.users(id) on delete cascade,  -- この人のアカウントで送る
  to_addr text not null,
  subject text not null default '',
  body text not null default '',
  -- 紐付け(送信後に email_messages へ引き継ぐ)
  contact_id uuid references contacts(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  template_id uuid references email_templates(id) on delete set null,
  mail_batch_id uuid references lead_mail_batches(id) on delete set null,
  unsubscribe_footer boolean not null default false,  -- リード宛の一括送信では true
  create_activity boolean not null default true,
  -- 実行結果
  email_message_id uuid references email_messages(id) on delete set null,
  sent_at timestamptz,
  attempts int not null default 0,
  error_text text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_scheduled_emails_due
  on public.scheduled_emails(scheduled_at) where status = 'scheduled';
create index if not exists idx_scheduled_emails_tenant
  on public.scheduled_emails(tenant_id, status, scheduled_at desc);
create trigger trg_scheduled_emails_updated before update on public.scheduled_emails
  for each row execute function public.set_updated_at();

alter table public.scheduled_emails enable row level security;
-- 参照はテナント内(誰の予約かは画面で区別)。作成/変更/削除は本人分のみ(誤操作防止)。
create policy sce_select on public.scheduled_emails for select
  using (tenant_id in (select current_tenant_ids()));
create policy sce_ins on public.scheduled_emails for insert
  with check (tenant_id in (select current_tenant_ids()) and sender_user_id = auth.uid());
create policy sce_upd on public.scheduled_emails for update
  using (tenant_id in (select current_tenant_ids()) and sender_user_id = auth.uid())
  with check (tenant_id in (select current_tenant_ids()) and sender_user_id = auth.uid());
create policy sce_del on public.scheduled_emails for delete
  using (tenant_id in (select current_tenant_ids()) and sender_user_id = auth.uid());

-- 予約送信ジョブの停止スイッチ(事故時に即OFFできる。既定ON)
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled)
select t.id, 'scheduled_mail', 'メール予約送信',
       '「送信日時を指定」で予約したメールを、指定時刻に送信者本人のアカウントから送信します。', true
from public.tenants t
where t.is_demo = false
on conflict (tenant_id, job_kind) do nothing;
