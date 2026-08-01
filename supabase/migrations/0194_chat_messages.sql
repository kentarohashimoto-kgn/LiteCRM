-- Google Chat メッセージ蓄積（P4: チャット内容をAIのソースにする）
-- Workspace Events の message.v1.created を購読し、Bot が参加しているスペースの
-- 会話を蓄積する。AI-PMO 等のプロンプトに「社内チャットの文脈」として注入する。
-- 書き込みは受信Webhook（service role）のみ。参照はテナント内メンバー。

create table if not exists public.chat_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  space_name          text not null,          -- "spaces/AAAA"
  message_name        text not null,          -- "spaces/AAAA/messages/BBBB"（冪等キー）
  thread_name         text,                   -- "spaces/AAAA/threads/CCCC"
  sender_chat_user_id text,                   -- Google Chat "users/1234567890"
  sender_user_id      uuid references auth.users(id) on delete set null, -- 解決済みCRMユーザー
  text                text not null,
  create_time         timestamptz,            -- Chat 側の投稿時刻
  created_at          timestamptz not null default now(),
  unique (message_name)
);
create index if not exists idx_chat_messages_tenant_time
  on public.chat_messages(tenant_id, create_time desc);

alter table public.chat_messages enable row level security;
-- 参照のみテナント内メンバーに許可。書き込みは service role（受信Webhook）のみ = RLSポリシー無し。
create policy chat_messages_select on public.chat_messages for select
  using (tenant_id in (select current_tenant_ids()));
