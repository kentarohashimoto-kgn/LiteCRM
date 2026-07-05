-- 各担当の空き時間(予約URL)。カレンダー下部に表示、設定画面で管理。
create table if not exists public.booking_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  label text not null,
  url text not null,
  owner_user_id uuid references public.profiles(id),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.booking_links enable row level security;
create policy bl_select on public.booking_links for select
  using (tenant_id = any(array(select current_tenant_ids())));
create policy bl_insert on public.booking_links for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy bl_update on public.booking_links for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy bl_delete on public.booking_links for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create trigger set_updated_at_booking_links before update on public.booking_links
  for each row execute function public.set_updated_at();

insert into public.booking_links (tenant_id, label, url, sort_order)
select t.id, x.label, x.url, x.so
from public.tenants t
cross join (values
  ('橋本', 'https://calendar.app.google/EBuosgtkRXpTkCSKA', 1),
  ('辰巳', 'https://calendar.app.google/GccZqqvc1qWSDWd1A', 2),
  ('LinkAI安東', 'https://app.spirinc.com/t/fiUExpgpTPh7oCphAudsl/as/XzTB1OW5tgBH5IV-6EZI1/confirm', 3),
  ('君嶋', 'https://calendar.app.google/qmh5fsEhFuGmiZTN9', 4),
  ('村上', 'https://calendar.app.google/qmh5fsEhFuGmiZTN9', 5),
  ('深瀬', 'https://timerex.net/s/n.fukase1205_8a45/f5d16a8f', 6),
  ('石川', 'https://app.aitemasu.me/u/fur2019/mtg60catorce', 7),
  ('AIDX二木', 'https://timerex.net/s/s.niki_279f/ca4909c1', 8)
) as x(label, url, so)
where not exists (select 1 from public.booking_links b where b.tenant_id = t.id);
