-- =====================================================================
-- Phase1: 施策ROI基盤 (marketing_channels / channel_costs / attribution)
-- ロールバック:
--   drop table channel_costs;
--   alter table leads drop column marketing_channel_id;
--   alter table opportunities drop column marketing_channel_id;
--   drop table marketing_channels;
-- =====================================================================
create table if not exists marketing_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  category text,
  lead_source_id uuid references lead_sources(id) on delete set null,
  kind text default 'other',
  cost_model text default 'none',
  default_monthly_cost numeric,
  per_result_cost numeric,
  committed_metric text,
  committed_qty numeric,
  target_level text,
  priority_flag boolean default false,
  status text not null default 'active',
  sort_order int default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mch_tenant on marketing_channels(tenant_id);
create index if not exists idx_mch_leadsrc on marketing_channels(lead_source_id);
alter table marketing_channels enable row level security;
create policy mch_sel on marketing_channels for select using (tenant_id in (select current_tenant_ids()));
create policy mch_ins on marketing_channels for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy mch_upd on marketing_channels for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy mch_del on marketing_channels for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create trigger mch_updtrg before update on marketing_channels for each row execute function set_updated_at();

create table if not exists channel_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel_id uuid not null references marketing_channels(id) on delete cascade,
  month date not null,
  fixed_cost numeric not null default 0,
  variable_cost numeric not null default 0,
  result_qty numeric,
  memo text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel_id, month)
);
create index if not exists idx_chcost_tenant on channel_costs(tenant_id);
create index if not exists idx_chcost_month on channel_costs(month);
alter table channel_costs enable row level security;
create policy chc_sel on channel_costs for select using (tenant_id in (select current_tenant_ids()));
create policy chc_ins on channel_costs for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy chc_upd on channel_costs for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy chc_del on channel_costs for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create trigger chc_updtrg before update on channel_costs for each row execute function set_updated_at();

alter table leads add column if not exists marketing_channel_id uuid references marketing_channels(id) on delete set null;
alter table opportunities add column if not exists marketing_channel_id uuid references marketing_channels(id) on delete set null;
create index if not exists idx_leads_mch on leads(marketing_channel_id);
create index if not exists idx_opps_mch on opportunities(marketing_channel_id);

-- 既存 lead_source ごとに施策を生成(attribution被覆)＋アトリビューションのバックフィル
insert into marketing_channels (tenant_id, name, category, lead_source_id, kind, sort_order)
select ls.tenant_id, ls.name,
  case ls.name when '展示会' then '展示会' when 'パートナー' then '代理店' when 'セミナー' then 'セミナー'
    when '交流会' then '交流会・イベント' when '紹介' then '紹介' when 'ライトアップ' then 'アポ代行'
    when 'BT' then 'マッチング' when '自社営業' then '自社営業' else 'その他' end,
  ls.id,
  case ls.name when '展示会' then 'event' when 'パートナー' then 'agency' when 'セミナー' then 'self'
    when '交流会' then 'event' when '紹介' then 'referral' when 'ライトアップ' then 'agency'
    when 'BT' then 'agency' when '自社営業' then 'self' else 'other' end,
  row_number() over (partition by ls.tenant_id order by ls.name)
from lead_sources ls
where not exists (select 1 from marketing_channels m where m.tenant_id = ls.tenant_id and m.lead_source_id = ls.id);

update leads l set marketing_channel_id = m.id
from marketing_channels m
where m.tenant_id = l.tenant_id and m.lead_source_id = l.lead_source_id and l.marketing_channel_id is null;
update opportunities o set marketing_channel_id = m.id
from marketing_channels m
where m.tenant_id = o.tenant_id and m.lead_source_id = o.lead_source_id and o.marketing_channel_id is null;
update opportunities o set marketing_channel_id = l.marketing_channel_id
from leads l where o.lead_id = l.id and o.marketing_channel_id is null and l.marketing_channel_id is not null;
