-- =====================================================================
-- WO-25: GWS OAuth接続(Gmail API・送受信) — F-101a 常時受信同期の"格上げ"(経路①)
--   単一Google Workspaceの営業向けに、アプリパスワード(IMAP/SMTP)ではなく
--   「内部(Internal)OAuthアプリ」でGoogleに正式に許可を出し、Gmail APIで送受信する。
--   scope: gmail.readonly(受信取込) + gmail.send(送信)。Googleの外部審査(CASA)は
--   Internalアプリなら不要(同一Workspace内のみ)。連携は営業個人ごと・段階導入可。
--
--   1ユーザー1アカウント(既存のunique制約)。auth_method で SMTP か OAuth を切替。
--   OAuthユーザーは smtp_* を持たないため NOT NULL を緩和。
--   リフレッシュトークンは AES-256-GCM 暗号化(MAIL_CRED_SECRET)。
-- =====================================================================

alter table public.user_mail_accounts
  add column if not exists auth_method text not null default 'smtp',   -- 'smtp' | 'google_oauth'
  add column if not exists oauth_refresh_token_enc text,               -- Googleリフレッシュトークン(暗号化)
  add column if not exists oauth_email text;                           -- 接続したGoogleアカウント(=from)

-- OAuthユーザーは SMTP資格情報を持たない → NOT NULL を緩和(既存SMTP行には影響なし)
alter table public.user_mail_accounts alter column smtp_host drop not null;
alter table public.user_mail_accounts alter column smtp_username drop not null;
alter table public.user_mail_accounts alter column smtp_password_enc drop not null;
