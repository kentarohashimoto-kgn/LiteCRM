-- =====================================================================
-- AI Lab（生成AI体験環境）
--
--   目的:
--     契約済み顧客のAI研修で、受講者が最新の生成AIツールを体感できる環境。
--     CRM本体とは画面・認証を分離し、会社別URL + Basic認証 + 個別ログインで入場する。
--     docs/AI_LAB_REQUIREMENTS_2026-08.md / AI_LAB_DETAILED_DESIGN_2026-08.md
--
--   認証モデル（重要）:
--     受講者は Supabase Auth のユーザーではない（auth.users に載らない）。
--     CRM側の memberships / RLS 前提を壊さないための意図的な分離であり、
--     受講者からのアクセスは全てアプリ層（service_role）を通す。
--     したがって ai_lab_* の RLS ポリシーは「CRM管理者(owner/admin)のテナント内操作」だけを許可し、
--     anon / authenticated の直クエリは実質全拒否になる（漏洩時の二重防御）。
-- =====================================================================

-- ── 会社（研修を受ける顧客企業）────────────────────────────────────
create table if not exists public.ai_lab_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- CRMの取引先への任意リンク。顧客詳細から体験環境へ飛ぶ導線に使う。
  account_id uuid references accounts(id) on delete set null,
  name text not null,
  -- 個別URL /lab/{slug}。予約語はアプリ側(LAB_RESERVED_SLUGS)でも弾く。
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  -- 入場ゲートのBasic認証。middleware(Edge)で比較するため SHA-256 hex で保持。
  -- ※本人認証は個別ログイン(ai_lab_users)が担う。Basicは「環境の一次ゲート」。
  basic_user text not null,
  basic_secret_hash text not null,
  -- 受講者に見せるモデル(ModelKeyの配列)と既定値。
  allowed_models text[] not null default '{claude-sonnet}',
  default_model text not null default 'claude-sonnet',
  -- 月間トークン予算(入出力合算)。null=無制限。
  monthly_token_budget bigint,
  is_active boolean not null default true,
  starts_on date,
  ends_on date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ai_lab_companies_tenant on public.ai_lab_companies(tenant_id, created_at desc);
create index if not exists idx_ai_lab_companies_account on public.ai_lab_companies(account_id);

-- ── 受講者 ─────────────────────────────────────────────────────────
create table if not exists public.ai_lab_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  login_id text not null,
  display_name text not null,
  -- 形式: scrypt$N$r$p$salt(base64)$hash(base64)。Node crypto の scrypt。
  password_hash text not null,
  is_active boolean not null default true,
  -- 管理者プレビュー専用の仮想ユーザー。ログインフォームからは常に拒否する。
  is_preview boolean not null default false,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, login_id)
);
create index if not exists idx_ai_lab_users_company on public.ai_lab_users(company_id, created_at);

-- ── プリセット（システムプロンプト＋参照アセットのセット）──────────
create table if not exists public.ai_lab_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  name text not null,
  description text,
  system_prompt text not null default '',
  -- 設定するとその会話ではモデルを固定する。null=受講者が選べる。
  model_key text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ai_lab_presets_company on public.ai_lab_presets(company_id, sort_order);

-- ── アセット（プリセットに注入する参考資料）────────────────────────
-- v1はテキスト/Markdownのみ。PDF抽出は後続フェーズ。
create table if not exists public.ai_lab_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  preset_id uuid not null references ai_lab_presets(id) on delete cascade,
  file_name text not null,
  mime text not null default 'text/plain',
  size_bytes bigint not null default 0,
  extracted_text text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_lab_assets_preset on public.ai_lab_assets(preset_id, created_at);

-- ── 会話 ───────────────────────────────────────────────────────────
create table if not exists public.ai_lab_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  user_id uuid not null references ai_lab_users(id) on delete cascade,
  preset_id uuid references ai_lab_presets(id) on delete set null,
  title text not null default '新しいチャット',
  last_model_key text,
  -- 受講者の削除は論理削除。管理者の利用ログには残す。
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ai_lab_conv_user on public.ai_lab_conversations(user_id, is_archived, updated_at desc);
create index if not exists idx_ai_lab_conv_company on public.ai_lab_conversations(company_id, updated_at desc);

-- ── メッセージ ─────────────────────────────────────────────────────
create table if not exists public.ai_lab_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  conversation_id uuid not null references ai_lab_conversations(id) on delete cascade,
  user_id uuid not null references ai_lab_users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  model_key text,
  provider text,
  input_tokens int,
  output_tokens int,
  -- 画像生成時の保存先(bucket: ai-lab-generated)。表示は署名URL。
  image_paths text[],
  -- provider_error / rate_limited / budget_exceeded / aborted / config_error
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_lab_msg_conv on public.ai_lab_messages(conversation_id, created_at);
-- レート制限(直近1分の送信数)の判定に使う。
create index if not exists idx_ai_lab_msg_user_recent on public.ai_lab_messages(user_id, created_at desc);

-- ── 日次利用集計（予算判定・管理画面の集計元）──────────────────────
create table if not exists public.ai_lab_usage_daily (
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  user_id uuid not null references ai_lab_users(id) on delete cascade,
  date date not null,
  model_key text not null,
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  images int not null default 0,
  primary key (company_id, user_id, date, model_key)
);
create index if not exists idx_ai_lab_usage_company_date on public.ai_lab_usage_daily(company_id, date);

-- 利用量の加算(upsert)。ストリーミング完了時にアプリから呼ぶ。
create or replace function public.ai_lab_add_usage(
  p_tenant uuid, p_company uuid, p_user uuid, p_date date, p_model text,
  p_requests int, p_in bigint, p_out bigint, p_images int
) returns void language sql security definer set search_path = public as $$
  insert into public.ai_lab_usage_daily as u
    (tenant_id, company_id, user_id, date, model_key, requests, input_tokens, output_tokens, images)
  values (p_tenant, p_company, p_user, p_date, p_model, p_requests, p_in, p_out, p_images)
  on conflict (company_id, user_id, date, model_key) do update
    set requests      = u.requests + excluded.requests,
        input_tokens  = u.input_tokens + excluded.input_tokens,
        output_tokens = u.output_tokens + excluded.output_tokens,
        images        = u.images + excluded.images;
$$;
-- 呼ぶのはアプリ(service_role)だけ。受講者・CRMユーザーからの直叩きは塞ぐ。
revoke execute on function public.ai_lab_add_usage(uuid, uuid, uuid, date, text, int, bigint, bigint, int) from public, anon, authenticated;
grant execute on function public.ai_lab_add_usage(uuid, uuid, uuid, date, text, int, bigint, bigint, int) to service_role;

-- ── 管理者プレビュー用ワンタイムトークン ───────────────────────────
create table if not exists public.ai_lab_preview_tokens (
  token text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── updated_at トリガ ──────────────────────────────────────────────
drop trigger if exists trg_ai_lab_companies_updated on public.ai_lab_companies;
create trigger trg_ai_lab_companies_updated before update on public.ai_lab_companies
  for each row execute function public.set_updated_at();
drop trigger if exists trg_ai_lab_presets_updated on public.ai_lab_presets;
create trigger trg_ai_lab_presets_updated before update on public.ai_lab_presets
  for each row execute function public.set_updated_at();
drop trigger if exists trg_ai_lab_conversations_updated on public.ai_lab_conversations;
create trigger trg_ai_lab_conversations_updated before update on public.ai_lab_conversations
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────
-- 方針: CRM管理者(owner/admin)が自テナントの行を全操作できる。それ以外は不可。
-- 受講者アクセスは service_role(RLSバイパス)で、アプリ層が company_id/user_id を強制する。
alter table public.ai_lab_companies      enable row level security;
alter table public.ai_lab_users          enable row level security;
alter table public.ai_lab_presets        enable row level security;
alter table public.ai_lab_assets         enable row level security;
alter table public.ai_lab_conversations  enable row level security;
alter table public.ai_lab_messages       enable row level security;
alter table public.ai_lab_usage_daily    enable row level security;
alter table public.ai_lab_preview_tokens enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'ai_lab_companies','ai_lab_users','ai_lab_presets','ai_lab_assets',
    'ai_lab_conversations','ai_lab_messages','ai_lab_usage_daily','ai_lab_preview_tokens'
  ] loop
    execute format('drop policy if exists %1$s_admin_all on public.%1$s', t);
    execute format($p$
      create policy %1$s_admin_all on public.%1$s for all
        using (tenant_id in (select current_tenant_ids())
               and current_role_in(tenant_id) in ('owner','admin'))
        with check (tenant_id in (select current_tenant_ids())
               and current_role_in(tenant_id) in ('owner','admin'))
    $p$, t);
  end loop;
end $$;

-- ── Storage: 生成画像の保管バケット（非公開・署名URLで配信）────────
insert into storage.buckets (id, name, public)
  values ('ai-lab-generated', 'ai-lab-generated', false)
  on conflict (id) do nothing;
