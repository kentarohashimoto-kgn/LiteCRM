-- =====================================================================
-- Googleカレンダーの「非公開URL(iCal形式)」による予定取り込み
--
--   背景: マインドマップの週次自動生成でカレンダー予定が最重要だが、
--         OAuth経路は Google Cloud Console 側で同意画面にカレンダースコープを
--         追加する必要があり、すぐには使えない。
--         iCal非公開URLならURLを1つ貼るだけで連携でき、Console作業が不要。
--
--   URLは実質的な認証情報(知っていれば誰でもカレンダーを読める)ため、
--   SMTPパスワードと同じく AES-256-GCM で暗号化して保存する(MAIL_CRED_SECRET)。
--   本人だけが読み書きできるように RLS を user_id = auth.uid() で縛る。
-- =====================================================================

create table if not exists public.user_calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ics_url_enc text not null,                       -- 非公開URL(暗号化)
  status text not null default 'active' check (status in ('active','disabled')),
  last_synced_at timestamptz,
  last_error text,
  last_event_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_calendar_feeds_tenant on public.user_calendar_feeds(tenant_id);

alter table public.user_calendar_feeds enable row level security;

drop policy if exists calendar_feeds_select on public.user_calendar_feeds;
drop policy if exists calendar_feeds_insert on public.user_calendar_feeds;
drop policy if exists calendar_feeds_update on public.user_calendar_feeds;
drop policy if exists calendar_feeds_delete on public.user_calendar_feeds;

-- 個人の資格情報なので、他人には(管理者にも)見せない
create policy calendar_feeds_select on public.user_calendar_feeds for select
  using (user_id = (select auth.uid()) and tenant_id in (select current_tenant_ids()));
create policy calendar_feeds_insert on public.user_calendar_feeds for insert
  with check (user_id = (select auth.uid()) and tenant_id in (select current_tenant_ids()));
create policy calendar_feeds_update on public.user_calendar_feeds for update
  using (user_id = (select auth.uid()) and tenant_id in (select current_tenant_ids()))
  with check (user_id = (select auth.uid()) and tenant_id in (select current_tenant_ids()));
create policy calendar_feeds_delete on public.user_calendar_feeds for delete
  using (user_id = (select auth.uid()) and tenant_id in (select current_tenant_ids()));

drop trigger if exists trg_calendar_feeds_updated_at on public.user_calendar_feeds;
create trigger trg_calendar_feeds_updated_at before update on public.user_calendar_feeds
  for each row execute function public.set_updated_at();
