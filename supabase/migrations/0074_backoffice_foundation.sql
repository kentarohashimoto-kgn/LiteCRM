-- 第7-8弾 バックオフィス基盤＋助成金トラッカー＋展示会WBS (docs/BACKOFFICE_DESIGN_2026-07.md)
-- ロール: back_office(事務) / hr(人事) を追加。営業データのRLS(can_view_all等)には
-- 追加しないため、BOロールは営業領域が自動的に0件になる。

-- ---- 権限ヘルパー ----
create or replace function public.is_backoffice(p_tenant uuid)
returns boolean language sql stable
set search_path = public
as $$ select current_role_in(p_tenant) in ('back_office','hr','owner','admin'); $$;

create or replace function public.is_hr(p_tenant uuid)
returns boolean language sql stable
set search_path = public
as $$ select current_role_in(p_tenant) in ('hr','owner','admin'); $$;

-- ---- 営業データへの最小の橋(secdef・許可列のみ) ----
-- 受注済みの研修案件: 会社名・案件名・受注日のみ(金額・ヨミは返さない)
create or replace function public.bo_training_deals()
returns jsonb language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'account_name', a.name, 'name', o.name, 'won_date', o.expected_close_date
  ) order by o.expected_close_date desc), '[]'::jsonb)
  from opportunities o
  left join accounts a on a.id = o.account_id
  where o.tenant_id in (select current_tenant_ids())
    and is_backoffice(o.tenant_id)
    and o.status = 'won' and o.deleted_at is null and o.category = 'training';
$$;

revoke execute on function public.bo_training_deals() from public, anon;
grant execute on function public.bo_training_deals() to authenticated;

-- ============================================================
-- BO-1 助成金トラッカー
-- ============================================================
create table if not exists public.subsidy_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null,
  account_name text not null,
  training_name text not null,
  training_start_date date not null,
  training_end_date date,
  program_name text not null default '人材開発支援助成金',
  assignee_user_id uuid references auth.users(id),
  status text not null default 'open', -- open/done/cancelled
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.subsidy_milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  case_id uuid not null references subsidy_cases(id) on delete cascade,
  kind text not null, -- briefing/pre_application/result_report/custom
  label text not null,
  due_date date not null,
  status text not null default 'todo', -- todo/done/na
  completed_at date,
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_subsidy_ms_due on public.subsidy_milestones(tenant_id, due_date) where status = 'todo';

alter table public.subsidy_cases enable row level security;
alter table public.subsidy_milestones enable row level security;
create policy subsidy_cases_all on public.subsidy_cases for all
  using (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id));
create policy subsidy_ms_all on public.subsidy_milestones for all
  using (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id));

-- ============================================================
-- BO-4 展示会準備WBS
-- ============================================================
create table if not exists public.expo_task_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text not null default 'その他', -- 出展手続/人員/制作物/物流/当日運営/その他
  offset_days int not null default -30,   -- 会期初日からのオフセット(負=前)
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.expo_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date,
  venue text,
  status text not null default 'planning', -- planning/confirmed/done/cancelled
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.expo_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references expo_projects(id) on delete cascade,
  name text not null,
  category text not null default 'その他',
  due_date date not null,
  assignee_user_id uuid references auth.users(id),
  status text not null default 'todo', -- todo/doing/done/na
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists public.expo_staffing (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references expo_projects(id) on delete cascade,
  date date not null,
  role text not null, -- lead_gen/field_sales/manager
  user_id uuid references auth.users(id),
  member_name text, -- 社外メンバー等の自由記述
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_expo_tasks_due on public.expo_tasks(tenant_id, due_date) where status in ('todo','doing');

alter table public.expo_task_templates enable row level security;
alter table public.expo_projects enable row level security;
alter table public.expo_tasks enable row level security;
alter table public.expo_staffing enable row level security;
do $$
declare t text;
begin
  foreach t in array array['expo_task_templates','expo_projects','expo_tasks','expo_staffing'] loop
    execute format('create policy %1$s_all on public.%1$s for all
      using (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id))
      with check (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id));', t);
  end loop;
end $$;

-- 初期タスクプリセット(全テナントへ。既にあるテナントはスキップ)
insert into public.expo_task_templates (tenant_id, name, category, offset_days, sort_order)
select t.id, v.name, v.category, v.offset_days, v.sort_order
from tenants t
cross join (values
  ('出展管理サイトへの登録', '出展手続', -60, 1),
  ('ブース仕様・小間割の提出', '出展手続', -45, 2),
  ('当日運営人員のアサイン(リード獲得/FS/管理者)', '人員', -30, 3),
  ('配布資料・ノベルティの手配', '制作物', -21, 4),
  ('名刺取込・リード取込体制の確認', '当日運営', -14, 5),
  ('備品・什器の発送', '物流', -7, 6),
  ('前日: 設営・動作確認', '当日運営', -1, 7),
  ('当日朝: 朝礼・役割最終確認', '当日運営', 0, 8)
) as v(name, category, offset_days, sort_order)
where not exists (select 1 from public.expo_task_templates x where x.tenant_id = t.id);
