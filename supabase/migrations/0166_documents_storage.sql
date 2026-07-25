-- =====================================================================
-- P1 統合ドキュメント基盤 (docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md)
--   documents: 全ファイルの統一台帳(実体は持たない。リンク/アップロード/スナップショットを統一管理)
--   tenant_storage_connections: テナント毎の外部ストレージ接続(第1号=Googleドライブ)
--   方針: マスターは外部ストレージ(リンク優先)。複製は発行物と証跡固定のみ。
-- =====================================================================

-- ---- テナント毎のストレージ接続 ----
create table if not exists public.tenant_storage_connections (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  provider       text not null,                 -- 'gdrive' | 'sharepoint' | 'box' ...
  display_name   text not null,                 -- 接続アカウントのメール等
  auth_kind      text not null check (auth_kind in ('oauth_user','oauth_org','service_account')),
  credentials    text,                          -- 暗号化済みリフレッシュトークン(crypto-mail.ts)
  config         jsonb not null default '{}',   -- gdrive: { categoryFolders: {folderId: category}, ... }
  status         text not null default 'active' check (status in ('active','error','revoked')),
  connected_by   uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, provider, display_name)
);
create index if not exists idx_tsc_tenant on public.tenant_storage_connections(tenant_id, provider);

alter table public.tenant_storage_connections enable row level security;
-- 資格情報を含むため、参照・操作とも owner/admin のみ。
-- バッチ・添付フロー(接続の存在確認/利用)は service role で行う。
drop policy if exists tsc_all on public.tenant_storage_connections;
create policy tsc_all on public.tenant_storage_connections for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));

drop trigger if exists tsc_updtrg on public.tenant_storage_connections;
create trigger tsc_updtrg before update on public.tenant_storage_connections
  for each row execute function public.set_updated_at();

-- ---- 統一ドキュメント台帳 ----
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,

  -- どこにあるか
  source_type   text not null check (source_type in ('link','upload','snapshot')),
  provider      text not null default 'gdrive',
  external_id   text,            -- Drive fileId 等(link時)
  external_rev  text,            -- リンク先の版(headRevisionId等)
  storage_path  text,            -- upload/snapshot時のバケット内パス
  web_url       text,            -- 人間が開くURL(webViewLink等)

  -- 何のファイルか
  title         text not null,
  mime_type     text,
  size_bytes    bigint,
  category      text,            -- '提案書'|'企画書'|'研修資料'|'技術資料'|... (フォルダから自動判定)
  tags          text[] not null default '{}',

  -- どこに紐づくか
  target_type   text,            -- 'opportunity'|'account'|'project'|'knowledge'|'library'
  target_id     uuid,

  -- 学習・ライフサイクル
  index_status  text not null default 'pending'
                check (index_status in ('pending','indexed','failed','skipped','excluded')),
  indexed_rev   text,
  link_status   text not null default 'ok'
                check (link_status in ('ok','moved','forbidden','deleted')),
  health_checked_at timestamptz,
  retention     text,            -- 'keep' | 'purge_after_unpublish' | 'purge_at:<date>'

  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_documents_target on public.documents(tenant_id, target_type, target_id, created_at desc);
create index if not exists idx_documents_health on public.documents(tenant_id, provider, health_checked_at)
  where source_type = 'link';
create index if not exists idx_documents_external on public.documents(tenant_id, provider, external_id);

alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (tenant_id in (select current_tenant_ids()));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (created_by = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );

drop trigger if exists documents_updtrg on public.documents;
create trigger documents_updtrg before update on public.documents
  for each row execute function public.set_updated_at();
