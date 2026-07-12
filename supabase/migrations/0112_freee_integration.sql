-- =====================================================================
-- freee 会計 連携（第1〜4弾）  docs/FREEE_INTEGRATION_DESIGN_2026-07.md
--   ・freee会計のみ（見積・請求も freee会計API）
--   ・請求は「検収時」: billing_schedules に検収状態を追加し、検収を起点に
--     請求書の「下書き」を生成 → 人が承認 → 発行
--   ・既存マスタ=freeeが正 / 今後の新規=CRMが正。名称変更はサイレント上書きせず
--     freee_links の対応表で名寄せ（変更 or 外部キー接続のみをユーザーが選択）
--   ・閲覧/操作は経理(finance)・代表(owner)・管理者(admin)のみ
--
--   トークン等の秘匿情報を持つ freee_connections は authenticated に一切
--   公開せず（service role からのみ読む）、状態は secdef RPC freee_status()
--   で許可列のみ返す（0040/0074 の secdef パターンを踏襲）。
-- =====================================================================

-- ---- 権限ヘルパー: 経理領域（経理/代表/管理者） ----
create or replace function public.is_finance(p_tenant uuid)
returns boolean language sql stable
set search_path = public
as $$ select current_role_in(p_tenant) in ('finance','owner','admin'); $$;

-- ---- 接続（OAuthトークン。秘匿。service roleのみアクセス） ----
create table if not exists public.freee_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id bigint,                                 -- freee 事業所ID
  company_name text,
  access_token text,                                 -- 秘匿（authenticatedには公開しない）
  refresh_token text,                                -- 秘匿
  token_expires_at timestamptz,
  connected_by uuid references auth.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_freee_conn_tenant on public.freee_connections(tenant_id);

-- ---- 名寄せ対応表（CRM ⇔ freee） ----
create table if not exists public.freee_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity_type text not null,                         -- account / item / opportunity / billing
  crm_id uuid not null,
  freee_id bigint not null,
  freee_name text,                                   -- freee側の名称（差分表示・参照用）
  link_mode text not null default 'linked',          -- linked(外部キー接続のみ) / renamed(CRM名称をfreeeに合わせた)
  synced_at timestamptz not null default now()
);
create unique index if not exists uq_freee_links_entity on public.freee_links(tenant_id, entity_type, crm_id);
create index if not exists idx_freee_links_freee on public.freee_links(tenant_id, entity_type, freee_id);

-- ---- 見積書（CRM案件 → freee見積） ----
create table if not exists public.freee_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  freee_quotation_id bigint,
  quote_number text,
  status text not null default 'draft',              -- draft(下書き) / issued(発行済)
  amount numeric not null default 0,
  issued_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_freee_quotes_opp on public.freee_quotes(opportunity_id);
create index if not exists idx_freee_quotes_tenant on public.freee_quotes(tenant_id);

-- ---- 請求書（検収 → freee請求。承認して発行） ----
create table if not exists public.freee_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  billing_schedule_id uuid references billing_schedules(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete cascade,
  freee_invoice_id bigint,
  invoice_number text,
  status text not null default 'draft',              -- draft / issued / paid
  amount numeric not null default 0,
  issue_date date,
  due_date date,
  paid_at date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_freee_invoices_opp on public.freee_invoices(opportunity_id);
create index if not exists idx_freee_invoices_bs on public.freee_invoices(billing_schedule_id);
create index if not exists idx_freee_invoices_tenant on public.freee_invoices(tenant_id);
create index if not exists idx_freee_invoices_due on public.freee_invoices(tenant_id, due_date) where status = 'issued';

-- ---- 連携ログ（監査・リトライ） ----
create table if not exists public.freee_sync_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  op text not null,                                  -- import_partners / push_partner / quote_draft / quote_issue / invoice_draft / invoice_issue / pull_payments 等
  direction text not null default 'push',            -- push / pull
  entity text,                                       -- account / opportunity / billing 等
  crm_id uuid,
  freee_id bigint,
  result text not null default 'ok',                 -- ok / error
  message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_freee_log_tenant on public.freee_sync_log(tenant_id, created_at desc);

-- ---- billing_schedules: 検収状態（請求のトリガ） ----
alter table public.billing_schedules add column if not exists accepted_on date;      -- 検収日（これが請求下書きの起点）
alter table public.billing_schedules add column if not exists billing_status text not null default 'pending';
      -- pending(未検収) / accepted(検収済・下書き待ち) / drafted(下書き有) / issued(発行済) / paid(入金済)

-- ---- updated_at トリガー ----
do $$
declare t text;
begin
  foreach t in array array['freee_connections','freee_quotes','freee_invoices'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
      for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ---- RLS ----
-- freee_connections: authenticated には一切公開しない（policy を作らない = 0件）。
-- トークンは service role（管理クライアント）からのみ読み書きする。
alter table public.freee_connections enable row level security;

-- 名寄せ・見積・請求・ログ: 経理領域のみ（is_finance）
do $$
declare t text;
begin
  foreach t in array array['freee_links','freee_quotes','freee_invoices','freee_sync_log'] loop
    execute format('alter table public.%1$s enable row level security;', t);
    execute format('drop policy if exists %1$s_all on public.%1$s;', t);
    execute format('create policy %1$s_all on public.%1$s for all
      using (tenant_id in (select current_tenant_ids()) and public.is_finance(tenant_id))
      with check (tenant_id in (select current_tenant_ids()) and public.is_finance(tenant_id));', t);
  end loop;
end $$;

-- ---- 接続状態を返す secdef RPC（秘匿列は返さない） ----
create or replace function public.freee_status()
returns jsonb language sql stable security definer
set search_path = public
as $$
  select case
    when not exists (
      select 1 from freee_connections c
      where c.tenant_id in (select current_tenant_ids()) and is_finance(c.tenant_id)
    ) then jsonb_build_object('connected', false)
    else (
      select jsonb_build_object(
        'connected', c.access_token is not null,
        'company_id', c.company_id,
        'company_name', c.company_name,
        'connected_at', c.connected_at,
        'token_expires_at', c.token_expires_at
      )
      from freee_connections c
      where c.tenant_id in (select current_tenant_ids()) and is_finance(c.tenant_id)
      limit 1
    )
  end;
$$;
revoke execute on function public.freee_status() from public, anon;
grant execute on function public.freee_status() to authenticated;
