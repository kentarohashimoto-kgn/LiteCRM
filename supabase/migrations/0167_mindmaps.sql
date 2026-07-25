-- =====================================================================
-- マインドマップ(管理者専用) — docs/MINDMAP_DESIGN_2026-07.md
--
--   目的:
--     ① Googleカレンダー × CRM/SFA(売上ヨミ・今月/来月クロージング) × 週次報告 を
--        取り込んで「今週・来週の予定」をマインドマップで可視化し、
--        前後関係・準備の漏れ(事前にやるべきこと)を洗い出す。
--     ② 研修/セミナー資料の構成検討と、マインドマップそのものでのプレゼン。
--
--   モデル: mindmaps ── mindmap_nodes(自己参照ツリー)
--                    └─ mindmap_links(枝をまたぐ関連線)
--
--   権限: owner / admin のみ(RLSで遮断)。営業・BO・人事からは存在ごと見えない。
-- =====================================================================

-- ---- ヘルパー: 管理者ロールで所属しているテナント(0119のinitplan方針に合わせる) ----
create or replace function public.admin_tenant_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select tenant_id from memberships
  where user_id = auth.uid() and status = 'active'
    and role in ('owner','admin');
$$;
revoke execute on function public.admin_tenant_ids() from public, anon;
grant execute on function public.admin_tenant_ids() to authenticated;

-- ---- マップ本体 ----
create table if not exists public.mindmaps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  -- weekly_plan=週次予定(自動生成) / seminar=研修・セミナー構成 / freeform=自由
  kind text not null default 'freeform' check (kind in ('weekly_plan','seminar','freeform')),
  source text not null default 'manual' check (source in ('manual','auto')),
  period_start date,                                  -- weekly_plan の対象週(月曜)
  layout text not null default 'right' check (layout in ('right','both')),
  note text,
  owner_user_id uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_mindmaps_tenant on public.mindmaps(tenant_id, updated_at desc);

-- ---- ノード(ツリー) ----
--   parent_id は自己参照。スナップショット保存(親子まとめてupsert)のため
--   外部キーを deferrable initially deferred にして文中の順序に依存しないようにする。
create table if not exists public.mindmap_nodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  mindmap_id uuid not null references mindmaps(id) on delete cascade,
  parent_id uuid references mindmap_nodes(id) on delete cascade
    deferrable initially deferred,                    -- null = ルート(マップに1つ)
  title text not null default '',
  note text,
  sort_order integer not null default 0,              -- 兄弟内の並び
  collapsed boolean not null default false,
  color text,                                          -- パレットキー(teal/orange/…) or null=親から継承
  marker text not null default 'none'
    check (marker in ('none','p1','p2','p3','flag','alert','star','done')),
  status text not null default 'none' check (status in ('none','todo','doing','done')),
  due_date date,
  -- 自動生成ノードの出典。CRM詳細への1クリック遷移に使う。
  ref_type text not null default 'none'
    check (ref_type in ('none','opportunity','account','task','meeting','calendar')),
  ref_id uuid,
  ref_url text,
  meta jsonb,                                          -- 生成時の補助情報(時刻・金額など)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mindmap_nodes_map on public.mindmap_nodes(mindmap_id, parent_id, sort_order);
create index if not exists idx_mindmap_nodes_tenant on public.mindmap_nodes(tenant_id);

-- ---- 関連線(枝をまたぐ破線矢印) ----
create table if not exists public.mindmap_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  mindmap_id uuid not null references mindmaps(id) on delete cascade,
  from_node_id uuid not null references mindmap_nodes(id) on delete cascade,
  to_node_id uuid not null references mindmap_nodes(id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);
create index if not exists idx_mindmap_links_map on public.mindmap_links(mindmap_id);

-- ---- RLS: owner/admin のみ(参照も更新も) ----
alter table public.mindmaps enable row level security;
alter table public.mindmap_nodes enable row level security;
alter table public.mindmap_links enable row level security;

do $$
declare t text;
begin
  foreach t in array array['mindmaps','mindmap_nodes','mindmap_links'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
    execute format('create policy %1$s_select on public.%1$s for select using (tenant_id in (select admin_tenant_ids()));', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (tenant_id in (select admin_tenant_ids()));', t);
    execute format('create policy %1$s_update on public.%1$s for update using (tenant_id in (select admin_tenant_ids())) with check (tenant_id in (select admin_tenant_ids()));', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (tenant_id in (select admin_tenant_ids()));', t);
  end loop;
end $$;

drop trigger if exists trg_mindmaps_updated_at on public.mindmaps;
create trigger trg_mindmaps_updated_at before update on public.mindmaps
  for each row execute function public.set_updated_at();

drop trigger if exists trg_mindmap_nodes_updated_at on public.mindmap_nodes;
create trigger trg_mindmap_nodes_updated_at before update on public.mindmap_nodes
  for each row execute function public.set_updated_at();
