-- 流入経路の詳細マスタ: 流入経路(lead_sources)ごとの選択肢
-- 例) 展示会→各展示会名 / パートナー→各パートナー名 / セミナー→各セミナー名。
-- 案件・リードの source_detail(テキスト)の入力を、マスタからの選択にする。

create table if not exists public.lead_source_details (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_source_id uuid not null references lead_sources(id) on delete cascade,
  name text not null,
  status text not null default 'active', -- active/inactive
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, lead_source_id, name)
);
create index if not exists idx_lsd_source on public.lead_source_details(lead_source_id);

-- RLS は lead_sources と同じ方針(閲覧=テナント全員 / 編集=owner/admin/sales_manager)
alter table public.lead_source_details enable row level security;
create policy lsd_select on public.lead_source_details for select
  using (tenant_id in (select current_tenant_ids()));
create policy lsd_write on public.lead_source_details for all
  using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'))
  with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in ('owner','admin','sales_manager'));

-- シード1: 既存案件の (流入経路, 流入詳細) の組み合わせから詳細マスタを起こす
insert into public.lead_source_details (tenant_id, lead_source_id, name)
select distinct o.tenant_id, o.lead_source_id, btrim(o.source_detail)
from opportunities o
where o.lead_source_id is not null
  and o.source_detail is not null and btrim(o.source_detail) <> ''
  and o.deleted_at is null
on conflict (tenant_id, lead_source_id, name) do nothing;

-- シード2: 展示会マスタ(campaigns channel='exhibition')を「展示会」経路の詳細として登録
insert into public.lead_source_details (tenant_id, lead_source_id, name)
select c.tenant_id, ls.id, c.name
from campaigns c
join lead_sources ls on ls.tenant_id = c.tenant_id and ls.name = '展示会'
where c.channel = 'exhibition'
on conflict (tenant_id, lead_source_id, name) do nothing;

-- 営業担当(can_edit_role)も流入詳細の追加は可能にする(更新・削除は owner/admin/sales_manager のまま)
create policy lsd_insert_editors on public.lead_source_details for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
