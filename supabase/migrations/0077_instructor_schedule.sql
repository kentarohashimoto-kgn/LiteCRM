-- 第12弾: BO AI講師スケジュール
-- 講師マスタ(日程調整URLを登録)＋研修実施回に時刻・会場・講師リンクを追加し、
-- 「どの講師がいつ何時にどの企業の研修をやるか」をカレンダーで見られるようにする。

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  schedule_url text,          -- 講師の日程調整リンク(TimeRex/Calendly等)
  email text,
  color text,                 -- カレンダー色(任意)
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.instructors enable row level security;
create policy instructors_all on public.instructors for all
  using (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id));

-- 研修実施回に時刻・会場・講師IDを追加(既存の instructor テキストは互換のため残す)
alter table public.training_sessions add column if not exists instructor_id uuid references instructors(id) on delete set null;
alter table public.training_sessions add column if not exists start_time time;
alter table public.training_sessions add column if not exists end_time time;
alter table public.training_sessions add column if not exists venue text;

-- 既存の instructor テキストから講師マスタを起こし、instructor_id を紐付け
do $$
declare r record; iid uuid;
begin
  for r in
    select distinct tenant_id, instructor
    from training_sessions
    where instructor is not null and btrim(instructor) <> ''
  loop
    insert into instructors (tenant_id, name)
    values (r.tenant_id, btrim(r.instructor))
    on conflict (tenant_id, name) do nothing;
    select id into iid from instructors where tenant_id = r.tenant_id and name = btrim(r.instructor);
    update training_sessions
      set instructor_id = iid
      where tenant_id = r.tenant_id and btrim(instructor) = btrim(r.instructor) and instructor_id is null;
  end loop;
end $$;
