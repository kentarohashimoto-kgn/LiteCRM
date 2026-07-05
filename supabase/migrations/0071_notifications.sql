-- A-1後半: アプリ内通知(ベル)。
-- 生成元: コメントの@メンション / Webフォーム新規リード / 毎朝のダイジェスト(cron)。
-- 参照・既読化は本人のみ。作成はテナント内メンバー(メンション用)＋service role(cron)。
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null, -- mention / lead / digest / system
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete
  using (user_id = auth.uid());
-- メンション通知など、テナント内メンバーが他メンバー宛に作成できる
create policy notifications_insert on public.notifications for insert
  with check (tenant_id in (select current_tenant_ids()));
