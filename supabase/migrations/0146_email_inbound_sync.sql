-- =====================================================================
-- WO-24: メール受信同期v1(IMAP) — F-101a 常時受信同期
--   各営業が接続済みのメールボックスを IMAP で定期取得し、
--   「該当メールだけ」(=自分の送信への返信 / 既知の取引先からの受信)を
--   抜粋+リンクで記録する。無関係な個人メール等は保存しない(ユーザー要望)。
--   返信を検知したら該当シーケンス投入を自動停止(stopped, reason='返信')。
--   資格情報は送信(SMTP)と同じアプリパスワードを再利用(IMAPホストのみ追加)。
--   連携は営業個人ごと。inbound_enabled=true の人だけ cron が処理する(段階導入可)。
--
--   加算的スキーマ。RLSは既存の user_mail_accounts / email_messages を踏襲。
-- =====================================================================

-- ---- 受信(IMAP)設定を user_mail_accounts に追加 ----
alter table public.user_mail_accounts
  add column if not exists imap_host text,
  add column if not exists imap_port int not null default 993,
  add column if not exists inbound_enabled boolean not null default false,  -- 受信取込のON/OFF(本人)
  add column if not exists imap_last_uid bigint not null default 0,          -- INBOXの取得済み最大UID(増分取得)
  add column if not exists inbound_last_run_at timestamptz,
  add column if not exists inbound_last_error text;

-- ---- email_messages に受信照合用の列を追加 ----
alter table public.email_messages
  add column if not exists smtp_message_id text,   -- 送信時のRFC Message-Id(返信照合の鍵) / 受信時は当該メールのMessage-Id
  add column if not exists in_reply_to text,        -- 受信メールの In-Reply-To(どの送信への返信か)
  add column if not exists provider_link text;      -- Gmail/Zohoでそのメールを開く/検索するリンク(抜粋+リンク方針)
-- 返信照合: 自分の送信 Message-Id を素早く引く
create index if not exists idx_email_messages_msgid on public.email_messages(tenant_id, smtp_message_id) where smtp_message_id is not null;

-- ---- 受信同期ジョブの停止スイッチ ----
insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'email_inbound_sync', 'メール受信同期(IMAP)',
   '受信取込を有効にした営業のメールボックスをIMAPで定期取得し、返信/既知取引先のメールのみ記録。返信でシーケンス自動停止。', true, null)
on conflict (tenant_id, job_kind) do nothing;
