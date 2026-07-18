-- =====================================================================
-- WO-22: メール送信(本人アカウント経由) + 開封/クリック トラッキング — F-101b/c
--   営業は GWS(Google Workspace) / Zoho の2系統。両者を1実装で扱うため、
--   各ユーザーが自分のメールボックスを SMTP(アプリパスワード)で接続し、
--   アプリがトラッキング(開封ピクセル/リンクラップ)を仕込んで本人アカウントから送信する。
--   → 送信は本人のSentにも残り、システムにも履歴(email_messages)が残る(ユーザー要望)。
--   送信ボタンが人の関所(レビュー→送信)。SMTP資格情報はアプリ側でAES-256-GCM暗号化して保存。
--
--   加算的スキーマ。全テーブル tenant_id + RLS + set_updated_at。
--   開封/クリックの記録(email_events/リンクのカウンタ)は公開エンドポイント(service role)から。
-- =====================================================================

-- ---- ユーザーのメール送信アカウント(SMTP接続。本人のみ) ----
create table if not exists public.user_mail_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'other',       -- 'gws'|'zoho'|'other'
  from_email text not null,
  from_name text,
  smtp_host text not null,
  smtp_port int not null default 465,
  smtp_secure boolean not null default true,     -- true=SSL(465) / false=STARTTLS(587)
  smtp_username text not null,
  smtp_password_enc text not null,               -- AES-256-GCM 暗号文(アプリ側で復号)
  bcc_self boolean not null default false,       -- 送信控えを自分にBCC(Zohoで確実にSentへ残す保険)
  status text not null default 'active',         -- 'active'|'disabled'
  verified_at timestamptz,                       -- 接続テスト成功時刻
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 1ユーザー1アカウント(MVP)
create unique index if not exists uq_user_mail_accounts_user on public.user_mail_accounts(tenant_id, user_id);
create trigger trg_user_mail_accounts_updated before update on public.user_mail_accounts
  for each row execute function public.set_updated_at();

alter table public.user_mail_accounts enable row level security;

-- 本人のみ参照・編集(資格情報を含むため厳格に)
drop policy if exists user_mail_accounts_select on public.user_mail_accounts;
create policy user_mail_accounts_select on public.user_mail_accounts for select
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));
drop policy if exists user_mail_accounts_insert on public.user_mail_accounts;
create policy user_mail_accounts_insert on public.user_mail_accounts for insert
  with check (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));
drop policy if exists user_mail_accounts_update on public.user_mail_accounts;
create policy user_mail_accounts_update on public.user_mail_accounts for update
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()))
  with check (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));
drop policy if exists user_mail_accounts_delete on public.user_mail_accounts;
create policy user_mail_accounts_delete on public.user_mail_accounts for delete
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));

-- ---- email_messages を送信・トラッキング対応に拡張 ----
alter table public.email_messages
  add column if not exists status text not null default 'logged',   -- 'logged'|'queued'|'sent'|'failed'
  add column if not exists sent_via text,                           -- 'gmail_compose'|'smtp'
  add column if not exists track_token text,                        -- 開封ピクセルのトークン(送信時に発行)
  add column if not exists open_count int not null default 0,
  add column if not exists last_opened_at timestamptz,
  add column if not exists click_count int not null default 0,
  add column if not exists last_clicked_at timestamptz,
  add column if not exists error_text text;
create unique index if not exists uq_email_messages_track_token on public.email_messages(track_token) where track_token is not null;

-- ---- トラッキング対象リンク(どの資料をクリックしたか) ----
create table if not exists public.email_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email_message_id uuid not null references email_messages(id) on delete cascade,
  token text not null,                           -- クリック計測トークン
  url text not null,                             -- 実リンク先(リダイレクト先)
  label text,                                    -- 資料名など(表示用)
  click_count int not null default 0,
  last_clicked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_email_links_token on public.email_links(token);
create index if not exists idx_email_links_msg on public.email_links(email_message_id);

alter table public.email_links enable row level security;
-- 参照は email_messages と同じ可視範囲(join で担保)。挿入は送信アクション(本人)。
drop policy if exists email_links_select on public.email_links;
create policy email_links_select on public.email_links for select using (
  tenant_id in (select view_all_tenant_ids())
  or exists (
    select 1 from email_messages m where m.id = email_message_id
      and (m.logged_by = (select auth.uid())
        or exists (select 1 from opportunities o where o.id = m.opportunity_id and o.owner_user_id = (select auth.uid())))
  )
);
drop policy if exists email_links_insert on public.email_links;
create policy email_links_insert on public.email_links for insert with check (
  tenant_id in (select current_tenant_ids())
  and exists (select 1 from email_messages m where m.id = email_message_id and m.logged_by = (select auth.uid()))
);

-- ---- 開封/クリック イベント ----
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email_message_id uuid not null references email_messages(id) on delete cascade,
  link_id uuid references email_links(id) on delete set null,   -- click の場合どのリンクか
  kind text not null,                            -- 'open'|'click'
  url text,                                       -- click の遷移先
  ip_hash text,                                   -- 生IPは保持しない(ハッシュのみ)
  user_agent text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_email_events_msg on public.email_events(email_message_id, occurred_at desc);
create index if not exists idx_email_events_tenant on public.email_events(tenant_id, occurred_at desc);

alter table public.email_events enable row level security;
-- 参照のみ(挿入は公開トラッキングエンドポイント=service role)。可視範囲は email_messages に準拠。
drop policy if exists email_events_select on public.email_events;
create policy email_events_select on public.email_events for select using (
  tenant_id in (select view_all_tenant_ids())
  or exists (
    select 1 from email_messages m where m.id = email_message_id
      and (m.logged_by = (select auth.uid())
        or exists (select 1 from opportunities o where o.id = m.opportunity_id and o.owner_user_id = (select auth.uid())))
  )
);

-- ---- 開封/クリックの記録RPC(公開エンドポイントが service role で呼ぶ・原子的加算) ----
create or replace function public.track_email_open(p_token text, p_ua text default null, p_ip text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_tenant uuid;
begin
  select id, tenant_id into v_id, v_tenant from email_messages where track_token = p_token;
  if v_id is null then return; end if;
  insert into email_events (tenant_id, email_message_id, kind, user_agent, ip_hash)
    values (v_tenant, v_id, 'open', p_ua, p_ip);
  update email_messages set open_count = open_count + 1, last_opened_at = now() where id = v_id;
end $$;
revoke execute on function public.track_email_open(text, text, text) from public, anon, authenticated;
grant execute on function public.track_email_open(text, text, text) to service_role;

create or replace function public.track_email_click(p_token text, p_ua text default null, p_ip text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link_id uuid; v_msg_id uuid; v_tenant uuid; v_url text;
begin
  select id, email_message_id, tenant_id, url into v_link_id, v_msg_id, v_tenant, v_url
    from email_links where token = p_token;
  if v_link_id is null then return null; end if;
  insert into email_events (tenant_id, email_message_id, link_id, kind, url, user_agent, ip_hash)
    values (v_tenant, v_msg_id, v_link_id, 'click', v_url, p_ua, p_ip);
  update email_links set click_count = click_count + 1, last_clicked_at = now() where id = v_link_id;
  update email_messages set click_count = click_count + 1, last_clicked_at = now() where id = v_msg_id;
  return v_url;
end $$;
revoke execute on function public.track_email_click(text, text, text) from public, anon, authenticated;
grant execute on function public.track_email_click(text, text, text) to service_role;
