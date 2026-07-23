-- Google Chat 連携（設計書: docs/GOOGLE_CHAT_INTEGRATION_DESIGN_2026-07.md）
-- P1(送信)で chat_identities / chat_space_bindings を使用。
-- P2/P3(受信)で chat_reaction_triggers / chat_subscriptions / chat_event_log を使用。
-- 全テーブル マルチテナント + RLS。参照はテナント内、設定変更は owner/admin/sales_manager。
-- cron/受信Webhook は service role で RLS をバイパスして書き込む。

-- ── chat_identities: CRM ユーザー ⇄ Google Chat ユーザー対応（DM送り分け・本人特定）──
create table if not exists public.chat_identities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  chat_user_id  text,                     -- Google Chat "users/1234567890"（未取得なら null → DMはスキップ）
  dm_space_name text,                     -- 解決済み DM Space "spaces/AAAA"（キャッシュ）
  email         text,                     -- GWSメール（突合キー）
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create unique index if not exists uq_chat_identities_chat_user
  on public.chat_identities(tenant_id, chat_user_id) where chat_user_id is not null;

alter table public.chat_identities enable row level security;
create policy chat_identities_select on public.chat_identities for select
  using (tenant_id in (select current_tenant_ids()));
create policy chat_identities_write on public.chat_identities for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));

-- ── chat_space_bindings: Google Chat Space ⇄ CRM エンティティの紐付け ──
create table if not exists public.chat_space_bindings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  space_name   text not null,             -- "spaces/AAAA"
  space_type   text not null default 'group', -- 'dm' | 'group'
  entity_type  text,                      -- 'deal' | 'account' | 'team' | null(汎用)
  entity_id    uuid,
  label        text,                      -- 人が読む用の表示名（例: "営業チーム"）
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (tenant_id, space_name)
);
create index if not exists idx_chat_space_bindings_entity
  on public.chat_space_bindings(tenant_id, entity_type, entity_id);

alter table public.chat_space_bindings enable row level security;
create policy chat_space_bindings_select on public.chat_space_bindings for select
  using (tenant_id in (select current_tenant_ids()));
create policy chat_space_bindings_write on public.chat_space_bindings for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));

-- ── chat_reaction_triggers: リアクション→アクション定義（P3で使用）──
create table if not exists public.chat_reaction_triggers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  emoji        text not null,             -- "✅" / ":white_check_mark:" / カスタム絵文字名
  scope        text not null default 'any', -- 'any' | 'space' | 'message_kind'
  space_name   text,
  message_kind text,                      -- 'danger_deal' | 'digest' 等（送信時に付与するタグ）
  action       text not null,             -- 'mark_reviewed' | 'snooze' | 'assign_me' | 'create_task' | 'escalate'
  action_args  jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.chat_reaction_triggers enable row level security;
create policy chat_reaction_triggers_select on public.chat_reaction_triggers for select
  using (tenant_id in (select current_tenant_ids()));
create policy chat_reaction_triggers_write on public.chat_reaction_triggers for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));

-- ── chat_subscriptions: Workspace Events 購読の管理（P3で使用。期限前更新cronが参照）──
create table if not exists public.chat_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  space_name        text not null,
  subscription_name text,                 -- Events API "subscriptions/XXXX"
  event_types       text[] not null default '{}',
  expire_time       timestamptz,
  state             text not null default 'active',
  updated_at        timestamptz not null default now(),
  unique (tenant_id, space_name)
);
alter table public.chat_subscriptions enable row level security;
create policy chat_subscriptions_select on public.chat_subscriptions for select
  using (tenant_id in (select current_tenant_ids()));
create policy chat_subscriptions_write on public.chat_subscriptions for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));

-- ── chat_event_log: 受信イベントの冪等性/監査（P2/P3で使用。Pub/Subは重複配信あり）──
create table if not exists public.chat_event_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  event_id     text not null,             -- Chat/Events の一意 ID（冪等キー）
  event_type   text not null,
  space_name   text,
  payload      jsonb,
  processed_at timestamptz not null default now(),
  unique (event_id)
);
create index if not exists idx_chat_event_log_space on public.chat_event_log(space_name, processed_at desc);
alter table public.chat_event_log enable row level security;
-- 参照のみテナント内メンバーに許可。書き込みは service role（受信Webhook）のみ = RLSポリシー無し。
create policy chat_event_log_select on public.chat_event_log for select
  using (tenant_id in (select current_tenant_ids()));
