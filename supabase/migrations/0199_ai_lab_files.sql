-- =====================================================================
-- AI Lab: ファイルの入出力
--
--   ① 受講者がPDF・画像を添付して質問できるようにする（入力）
--   ② AIがxlsx・docx・pptx・pdfを作って受講者がダウンロードできるようにする（出力）
--
--   出力は Anthropic の Agent Skills（xlsx/docx/pptx/pdf）＋コード実行ツールで生成する。
--   コード実行には従量課金が発生しうるため、会社ごとにオン/オフできるようにしている。
--
--   添付・生成物はどちらも同じ ai_lab_attachments で扱い、kind と origin で区別する。
--   受講者・会社の境界は ai_lab_* の他テーブルと同じくアプリ層(service_role)が担保する。
-- =====================================================================

-- コード実行を伴うファイル生成の可否。既定はオン（研修の主目的のひとつのため）。
alter table public.ai_lab_companies
  add column if not exists file_tools_enabled boolean not null default true;

create table if not exists public.ai_lab_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  user_id uuid not null references ai_lab_users(id) on delete cascade,
  -- 会話・メッセージは「アップロード時点では未確定」なので後から紐づける。
  conversation_id uuid references ai_lab_conversations(id) on delete cascade,
  message_id uuid references ai_lab_messages(id) on delete cascade,
  -- upload=受講者が添付したもの / generated=AIが作ったもの
  origin text not null default 'upload' check (origin in ('upload','generated')),
  -- image=画像(視覚入力) / document=PDF等(文書入力) / output=生成物
  kind text not null check (kind in ('image','document','output')),
  file_name text not null,
  mime text not null,
  size_bytes bigint not null default 0,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_lab_att_message on public.ai_lab_attachments(message_id);
create index if not exists idx_ai_lab_att_conv on public.ai_lab_attachments(conversation_id, created_at);
-- 会話に紐づく前の孤児（アップロードしたまま送信しなかった分）を掃除するための索引。
create index if not exists idx_ai_lab_att_orphan on public.ai_lab_attachments(created_at)
  where message_id is null;

alter table public.ai_lab_attachments enable row level security;

drop policy if exists ai_lab_attachments_admin_all on public.ai_lab_attachments;
create policy ai_lab_attachments_admin_all on public.ai_lab_attachments for all
  using (tenant_id in (select current_tenant_ids())
         and current_role_in(tenant_id) in ('owner','admin'))
  with check (tenant_id in (select current_tenant_ids())
         and current_role_in(tenant_id) in ('owner','admin'));

-- 受講者がアップロードしたファイルの置き場（非公開・署名URLで配信）。
insert into storage.buckets (id, name, public)
  values ('ai-lab-uploads', 'ai-lab-uploads', false)
  on conflict (id) do nothing;
