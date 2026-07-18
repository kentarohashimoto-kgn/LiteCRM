-- =====================================================================
-- AI-PMO: ベテランPMアドバイザー機能 — レポート保存テーブル
--   CRM横断データ(案件/PJ/タスク/商談/目標実績)を集約し、Claudeが
--   「鳥の目(俯瞰)・虫の目(詳細)・魚の目(トレンド)・コウモリの目(逆視点)」
--   の4視点でPDCA振り返り/未来の段取り/PJ管理/経営分析レポートを生成。
--   生成結果と入力ダイジェスト(再現用スナップショット)を本テーブルに保存する。
--
--   加算的スキーマ(既存を壊さない)。tenant_id + RLS4点セット + set_updated_at。
-- =====================================================================

create table if not exists public.pmo_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  mode text not null check (mode in ('retrospective','planning','project','executive')),
  title text not null,
  report_md text not null,               -- AI生成レポート本文(Markdown)
  alerts jsonb not null default '[]'::jsonb,   -- 生成時点のルールベース検知アラート
  digest jsonb not null default '{}'::jsonb,   -- AIに渡したデータダイジェスト(スナップショット)
  model text,                            -- 使用したAIモデルID
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pmo_reports_tenant_at on public.pmo_reports(tenant_id, created_at desc);
create index if not exists idx_pmo_reports_mode on public.pmo_reports(tenant_id, mode, created_at desc);
create trigger trg_pmo_reports_updated before update on public.pmo_reports
  for each row execute function public.set_updated_at();

alter table public.pmo_reports enable row level security;

-- 参照: テナントメンバー全員(レポートはチームで共有する)
drop policy if exists pmo_reports_select on public.pmo_reports;
create policy pmo_reports_select on public.pmo_reports for select
  using (tenant_id in (select current_tenant_ids()));
-- 作成: 編集可能ロール(営業/管理職などがボタンから生成)
drop policy if exists pmo_reports_insert on public.pmo_reports;
create policy pmo_reports_insert on public.pmo_reports for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
-- 更新: 編集可能ロール
drop policy if exists pmo_reports_update on public.pmo_reports;
create policy pmo_reports_update on public.pmo_reports for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
-- 削除: owner/admin のみ
drop policy if exists pmo_reports_delete on public.pmo_reports;
create policy pmo_reports_delete on public.pmo_reports for delete
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin'));
