-- B1: カトルセの型(営業プレイブック)。業種×規模×役職 別の勝ち筋を構造化して蓄積する資産。
-- 事前ブリーフィング(B2)や事例レコメンドから参照される。v1は手動登録＋検索。将来pgvectorでRAG参照。
create table if not exists public.sales_playbooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  industry text,                 -- 適用業種(NULL=汎用)
  employee_size_band text,       -- 会社規模帯
  target_role text,              -- 相手役職(経営者/情シス/現場 等)
  solution_package_id uuid references solution_packages(id) on delete set null,
  hypothesis_issues text,        -- 想定課題
  value_props text,              -- 刺さる訴求
  key_questions text,            -- 初回質問リスト
  proposal_flow text,            -- 提案の流れ
  objections text,               -- 反論と切り返し
  decision_tips text,            -- 決裁の勘所
  source text not null default 'manual' check (source in ('manual','interview','data_mined')),
  status text not null default 'active' check (status in ('draft','active','archived')),
  win_count int not null default 0,
  loss_count int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_playbooks_tenant on public.sales_playbooks(tenant_id, status, created_at desc);

alter table public.sales_playbooks enable row level security;

drop policy if exists playbooks_select on public.sales_playbooks;
drop policy if exists playbooks_insert on public.sales_playbooks;
drop policy if exists playbooks_update on public.sales_playbooks;
drop policy if exists playbooks_delete on public.sales_playbooks;

create policy playbooks_select on public.sales_playbooks for select
  using (tenant_id in (select current_tenant_ids()));
create policy playbooks_insert on public.sales_playbooks for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy playbooks_update on public.sales_playbooks for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy playbooks_delete on public.sales_playbooks for delete
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

drop trigger if exists trg_playbooks_updated_at on public.sales_playbooks;
create trigger trg_playbooks_updated_at before update on public.sales_playbooks
  for each row execute function public.set_updated_at();
