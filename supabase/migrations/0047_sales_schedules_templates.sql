-- WO-05: 新規商談ワークフロー。初回商談後のスケジュール分類＋本部承認、業種/職種テンプレ。

-- 営業スケジュール分類（1案件=最新1件を有効とする）
create table if not exists public.sales_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  schedule_type text not null,     -- A_short_term/B_subsidy_budget/C_multi_stakeholder/D_long_term/E_nurturing
  reason text not null,
  proposed_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approval_status text not null default 'pending',  -- pending/approved/rejected/needs_revision
  approval_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sales_schedules enable row level security;
create policy ss_select on public.sales_schedules for select
  using (tenant_id = any(array(select current_tenant_ids())));
create policy ss_insert on public.sales_schedules for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy ss_update on public.sales_schedules for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy ss_delete on public.sales_schedules for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create trigger set_updated_at_sales_schedules before update on public.sales_schedules
  for each row execute function public.set_updated_at();
create index if not exists idx_sales_schedules_opp on public.sales_schedules(tenant_id, opportunity_id, created_at desc);

-- 業種別/職種別テンプレート
create table if not exists public.sales_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  template_type text not null,     -- 'industry' | 'role'
  key_name text not null,
  pitch text not null,
  hearing_points text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sales_templates enable row level security;
create policy st_select on public.sales_templates for select
  using (tenant_id = any(array(select current_tenant_ids())));
create policy st_insert on public.sales_templates for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy st_update on public.sales_templates for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy st_delete on public.sales_templates for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create trigger set_updated_at_sales_templates before update on public.sales_templates
  for each row execute function public.set_updated_at();

-- 業種8＋職種6をテナントごとにシード（既にあればスキップ）
insert into public.sales_templates (tenant_id, template_type, key_name, pitch)
select t.id, x.tt, x.k, x.p
from public.tenants t
cross join (values
  ('industry','製造業','技術資料・問い合わせ対応・検査・報告書・図面/仕様書活用'),
  ('industry','建設業','積算・見積・現場報告・写真整理・安全書類・事務効率化'),
  ('industry','情報システム','社内問い合わせ・ヘルプデスク・AIガバナンス・バイブコーディング'),
  ('industry','営業部門','提案書作成・商談議事録・営業週報・リード分析'),
  ('industry','人事・研修部門','AI人材育成・eラーニング・研修定着・社内展開'),
  ('industry','経理・管理部門','請求書処理・稟議・FAQ・規程検索・レポート作成'),
  ('industry','物流','配車・問い合わせ・帳票・在庫・システム刷新'),
  ('industry','不動産・住宅','物件資料・提案書・間取り・顧客対応・営業支援'),
  ('role','社長','人手不足解消・利益率向上・AI導入ロードマップ'),
  ('role','情シス','問い合わせ削減・AI利用ルール・社内展開・セキュリティ'),
  ('role','人事','AI研修・助成金・eラーニング・スキル可視化'),
  ('role','営業部長','提案書作成・商談後追い・営業生産性'),
  ('role','DX推進','全社展開・AI推進者育成・活用事例創出'),
  ('role','現場責任者','日常業務の時短・問い合わせ削減・属人化解消')
) as x(tt, k, p)
where not exists (select 1 from public.sales_templates s where s.tenant_id = t.id);
