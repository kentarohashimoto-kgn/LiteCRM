-- =====================================================================
-- P2 ドライブ権限ガバナンス (docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md §3.5/3.6)
--   外部委託メンバーにもアクセス権を付与する前提のため、
--   「人が思い出す」に頼らず CRM が権限を継続監査する。
--     drive_permission_snapshots : 夜間に取得した権限の実測スナップショット
--     drive_permission_findings  : 突合で検出した要対応事項(残存権限・NDA未締結 等)
--     external_agreements        : NDA台帳(外部アドレスの照合元)
--     offboarding_checklists     : メンバー削除時に自動生成する剥奪チェックリスト
--   参照・操作はいずれも owner/admin のみ(権限情報そのものが機微なため)。
-- =====================================================================

-- ---- 権限スナップショット ----
create table if not exists public.drive_permission_snapshots (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  taken_on      date not null default (now() at time zone 'Asia/Tokyo')::date,
  scope_kind    text not null check (scope_kind in ('drive','folder')),
  scope_id      text not null,
  scope_name    text,
  permission_id text,
  grantee_type  text,                       -- user | group | domain | anyone
  email         text,
  role          text,                       -- organizer | fileOrganizer | writer | commenter | reader
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_dps_tenant_day on public.drive_permission_snapshots(tenant_id, taken_on desc);
create index if not exists idx_dps_scope on public.drive_permission_snapshots(tenant_id, scope_id, taken_on desc);

alter table public.drive_permission_snapshots enable row level security;
drop policy if exists dps_select on public.drive_permission_snapshots;
create policy dps_select on public.drive_permission_snapshots for select
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- ---- 検出事項 ----
create table if not exists public.drive_permission_findings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  kind         text not null,               -- deleted_account | unknown_member | no_nda | bo_intrusion | direct_grant | new_external | offboarding
  severity     text not null default 'warn' check (severity in ('info','warn','high')),
  scope_id     text,
  scope_name   text,
  email        text,
  detail       text not null,
  status       text not null default 'open' check (status in ('open','acknowledged','resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_by  uuid references auth.users(id),
  resolved_at  timestamptz,
  -- 同一事象は1行に集約(日次で last_seen_at のみ更新)
  unique (tenant_id, kind, scope_id, email)
);
create index if not exists idx_dpf_open on public.drive_permission_findings(tenant_id, status, severity);

alter table public.drive_permission_findings enable row level security;
drop policy if exists dpf_select on public.drive_permission_findings;
create policy dpf_select on public.drive_permission_findings for select
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
drop policy if exists dpf_update on public.drive_permission_findings;
create policy dpf_update on public.drive_permission_findings for update
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

-- ---- NDA台帳 ----
create table if not exists public.external_agreements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,
  display_name text,
  kind        text not null default 'NDA',
  signed_on   date,
  expires_on  date,                          -- null = 無期限
  document_id uuid references documents(id) on delete set null,  -- 証跡(静止点)
  note        text,
  status      text not null default 'active' check (status in ('active','terminated')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, email, kind)
);
create index if not exists idx_ea_tenant on public.external_agreements(tenant_id, status);

alter table public.external_agreements enable row level security;
drop policy if exists ea_all on public.external_agreements;
create policy ea_all on public.external_agreements for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

drop trigger if exists ea_updtrg on public.external_agreements;
create trigger ea_updtrg before update on public.external_agreements
  for each row execute function public.set_updated_at();

-- ---- オフボーディング・チェックリスト ----
create table if not exists public.offboarding_checklists (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  target_email text,
  target_name  text,
  items        jsonb not null default '[]'::jsonb,   -- [{key,label,done,done_at,done_by}]
  status       text not null default 'open' check (status in ('open','done')),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_oc_open on public.offboarding_checklists(tenant_id, status, created_at desc);

alter table public.offboarding_checklists enable row level security;
drop policy if exists oc_all on public.offboarding_checklists;
create policy oc_all on public.offboarding_checklists for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

drop trigger if exists oc_updtrg on public.offboarding_checklists;
create trigger oc_updtrg before update on public.offboarding_checklists
  for each row execute function public.set_updated_at();
