-- 展示会/施策別の受注・売上・原価・ROI。案件の「詳細」を列化＋原価テーブル＋集計RPC。
-- ロールバック: alter table opportunities drop column source_detail; drop table deal_detail_costs; drop function exhibition_deal_roi(date,date);
alter table opportunities add column if not exists source_detail text;
create index if not exists idx_opps_source_detail on opportunities(source_detail);
update opportunities set source_detail = btrim(substring(notes from '流入詳細:([^/]+)'))
where source_detail is null and notes like '%流入詳細:%';

create table if not exists deal_detail_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  detail text not null, cost numeric not null default 0, note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, detail)
);
alter table deal_detail_costs enable row level security;
create policy ddc_sel on deal_detail_costs for select using (tenant_id in (select current_tenant_ids()));
create policy ddc_ins on deal_detail_costs for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy ddc_upd on deal_detail_costs for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy ddc_del on deal_detail_costs for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create trigger ddc_updtrg before update on deal_detail_costs for each row execute function set_updated_at();

create or replace function public.exhibition_deal_roi(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v uuid[]; r jsonb;
begin
  v := array(select current_tenant_ids());
  if v is null or array_length(v,1) is null then return '[]'::jsonb; end if;
  with op as materialized (
    select btrim(source_detail) detail,
      count(*) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end) deals,
      coalesce(sum(amount) filter (where status='won' and expected_close_date >= p_start and expected_close_date < p_end),0) revenue,
      count(*) filter (where status='open') open_deals,
      coalesce(sum(amount) filter (where status='open'),0) open_amount
    from opportunities where tenant_id = any(v) and source_detail is not null and btrim(source_detail) <> ''
    group by btrim(source_detail)
  ),
  c as materialized (select btrim(detail) detail, sum(cost) cost from deal_detail_costs where tenant_id = any(v) group by btrim(detail))
  select coalesce(jsonb_agg(jsonb_build_object('detail',op.detail,'deals',op.deals,'revenue',op.revenue,
    'open_deals',op.open_deals,'open_amount',op.open_amount,'cost',coalesce(c.cost,0)) order by op.revenue desc), '[]'::jsonb)
  into r from op left join c on c.detail = op.detail;
  return coalesce(r,'[]'::jsonb);
end; $function$;
