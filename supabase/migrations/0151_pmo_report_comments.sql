-- =====================================================================
-- AI-PMO: レポートへのカトルセ(社内)コメント
--   各レポートに社内コメントを付与できる。コメントは次回の夜間バッチ生成時に
--   「カトルセからのフィードバック」としてAIプロンプトへ注入され、分析に反映される
--   (人間→AIのフィードバックループ)。
--
--   加算的スキーマ。tenant_id + RLS4点セット + set_updated_at。
-- =====================================================================

create table if not exists public.pmo_report_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  report_id uuid not null references pmo_reports(id) on delete cascade,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pmo_comments_report on public.pmo_report_comments(report_id, created_at);
create index if not exists idx_pmo_comments_tenant_at on public.pmo_report_comments(tenant_id, created_at desc);
create trigger trg_pmo_comments_updated before update on public.pmo_report_comments
  for each row execute function public.set_updated_at();

alter table public.pmo_report_comments enable row level security;

-- 参照: テナントメンバー全員
drop policy if exists pmo_comments_select on public.pmo_report_comments;
create policy pmo_comments_select on public.pmo_report_comments for select
  using (tenant_id in (select current_tenant_ids()));
-- 作成: 編集可能ロールが自分名義で
drop policy if exists pmo_comments_insert on public.pmo_report_comments;
create policy pmo_comments_insert on public.pmo_report_comments for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id) and created_by = auth.uid());
-- 更新: 自分のコメントのみ
drop policy if exists pmo_comments_update on public.pmo_report_comments;
create policy pmo_comments_update on public.pmo_report_comments for update
  using (tenant_id in (select current_tenant_ids()) and created_by = auth.uid())
  with check (tenant_id in (select current_tenant_ids()) and created_by = auth.uid());
-- 削除: 自分のコメント or owner/admin
drop policy if exists pmo_comments_delete on public.pmo_report_comments;
create policy pmo_comments_delete on public.pmo_report_comments for delete
  using (tenant_id in (select current_tenant_ids())
    and (created_by = auth.uid() or current_role_in(tenant_id) in ('owner','admin')));
