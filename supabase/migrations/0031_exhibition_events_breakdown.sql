-- 展示会の時系列・主催・テーマ分析: raw_event単位のマスタ + 集計RPC
-- ロールバック: drop function exhibition_breakdown(date,date); drop table exhibition_events;
create table if not exists exhibition_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  raw_event text not null,
  label text, ym text, organizer text, theme text, cost numeric, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, raw_event)
);
alter table exhibition_events enable row level security;
create policy exe_sel on exhibition_events for select using (tenant_id in (select current_tenant_ids()));
create policy exe_ins on exhibition_events for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy exe_upd on exhibition_events for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy exe_del on exhibition_events for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create trigger exe_updtrg before update on exhibition_events for each row execute function set_updated_at();

insert into exhibition_events (tenant_id, raw_event, ym, label)
select distinct l.tenant_id, l.raw_event,
  (substring(l.raw_event from '^[0-9]{6}')),
  nullif(regexp_replace(l.raw_event, '^[0-9]{6,8}_?', ''), '')
from leads l join marketing_channels m on m.id = l.marketing_channel_id
where m.category = '展示会' and l.raw_event is not null and l.raw_event ~ '^[0-9]{6}'
  and not exists (select 1 from exhibition_events e where e.tenant_id = l.tenant_id and e.raw_event = l.raw_event);

create or replace function public.exhibition_breakdown(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenants uuid[]; v_result jsonb;
begin
  v_tenants := array(select current_tenant_ids());
  if v_tenants is null or array_length(v_tenants,1) is null then return '[]'::jsonb; end if;
  with ev as materialized (
    select raw_event, ym, label, organizer, theme, cost from exhibition_events where tenant_id = any(v_tenants)
  ),
  ld as materialized (
    select l.raw_event, count(*) leads,
      count(*) filter (where l.funnel_stage='appointment' or l.disposition='appointment') appts
    from leads l join marketing_channels m on m.id = l.marketing_channel_id
    where l.tenant_id = any(v_tenants) and m.category='展示会' and l.raw_event is not null
      and l.acquired_at >= p_start and l.acquired_at < p_end
    group by l.raw_event
  ),
  wn as materialized (
    select l.raw_event, count(*) deals, coalesce(sum(o.amount),0) revenue
    from opportunities o join leads l on l.id = o.lead_id
    where o.tenant_id = any(v_tenants) and o.status='won'
      and o.expected_close_date >= p_start and o.expected_close_date < p_end and l.raw_event is not null
    group by l.raw_event
  ),
  keys as (select raw_event from ev union select raw_event from ld union select raw_event from wn)
  select coalesce(jsonb_agg(jsonb_build_object(
    'raw_event', k.raw_event,
    'ym', coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}')),
    'label', coalesce(ev.label, regexp_replace(k.raw_event, '^[0-9]{6,8}_?', '')),
    'organizer', ev.organizer, 'theme', ev.theme, 'cost', ev.cost,
    'leads', coalesce(ld.leads,0), 'appts', coalesce(ld.appts,0),
    'deals', coalesce(wn.deals,0), 'revenue', coalesce(wn.revenue,0)
  ) order by coalesce(ev.ym, substring(k.raw_event from '^[0-9]{6}'))), '[]'::jsonb)
  into v_result
  from keys k left join ev on ev.raw_event=k.raw_event left join ld on ld.raw_event=k.raw_event left join wn on wn.raw_event=k.raw_event;
  return coalesce(v_result, '[]'::jsonb);
end; $function$;
