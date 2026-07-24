-- =====================================================================
-- 原価管理: デリバリー見込み（継続/延長・新規受注見込み）と人員手配の可視化
--   確定/完了とは別枠で「今後の見込み」を簡単に登録し、
--   継続・延長や新規受注の見込みを期間バーで俯瞰する。
--   必要人員・手配状況・契約(採用)調整期限を持たせ、
--   「半年後の受注見込み → 採用/契約を急ぐべき」を可視化する。
--   閲覧・操作は原価管理と同じく管理職のみ(is_project_mgr)。
-- =====================================================================

create table if not exists public.delivery_forecasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null, -- 継続元の案件(任意)
  account_id uuid references accounts(id) on delete set null,          -- 顧客(任意)
  kind text not null default 'continuation',        -- continuation(継続/延長) | new(新規見込み)
  title text not null,                              -- 表示名(例: 日本トムソン(継続))
  start_month date,                                 -- YYYY-MM-01
  end_month date,
  amount numeric,                                   -- 金額(basis に応じ 月額 or 総額)
  amount_basis text not null default 'monthly',     -- monthly(月額) | total(総額)
  probability int not null default 50,              -- 受注確度 0..100
  required_headcount numeric,                       -- 必要人数(同時稼働)
  staffing_status text not null default 'unknown',  -- ready(手当済) | shortage(要手配) | unknown(未定)
  arrange_deadline date,                            -- 契約/採用の調整期限
  owner_user_id uuid references auth.users(id),
  notes text,
  status text not null default 'active',            -- active | archived
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_df_tenant on public.delivery_forecasts(tenant_id);
create index if not exists idx_df_opp on public.delivery_forecasts(opportunity_id);

alter table public.delivery_forecasts enable row level security;
drop policy if exists delivery_forecasts_all on public.delivery_forecasts;
create policy delivery_forecasts_all on public.delivery_forecasts for all
  using (tenant_id in (select current_tenant_ids()) and public.is_project_mgr(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and public.is_project_mgr(tenant_id));

drop trigger if exists df_updtrg on public.delivery_forecasts;
create trigger df_updtrg before update on public.delivery_forecasts
  for each row execute function public.set_updated_at();
