-- =====================================================================
-- profiles テーブル(表示名・アバター) と サインアップ連動トリガ
-- auth.users を直接参照せずにメンバー名/アバターを表示するための鏡像テーブル。
-- =====================================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_color text default '#008C8C',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- 自分 or 同一テナントのメンバーの profile を参照可能
create policy profiles_select on profiles for select using (
  id = auth.uid() or exists (
    select 1 from memberships m1
    join memberships m2 on m1.tenant_id = m2.tenant_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);
create policy profiles_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- 新規 auth ユーザー作成時に profile を自動作成
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name, avatar_color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_color', '#008C8C')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();
