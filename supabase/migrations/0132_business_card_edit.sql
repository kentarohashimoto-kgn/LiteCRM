-- =====================================================================
-- 0132: 名刺情報の編集・コメント・アクション優先度/任意タグ
--   - スキャン誤り修正のための編集（変更履歴は fn_audit_row で自動記録）
--   - 名刺ごとの社内コメントスレッド（lead_comments と同設計）
--   - あとでアクションする名刺のマークアップ: priority（高/中/低）＋ user_tags（任意タグ）
--     ※Eight由来のイベントタグ(tags)とは分離して管理する
-- =====================================================================

-- ---- 優先度・任意タグ ----
alter table public.business_cards
  add column if not exists priority text check (priority in ('high','medium','low')),
  add column if not exists user_tags text[] not null default '{}';

create index if not exists idx_business_cards_priority
  on public.business_cards(tenant_id, priority) where priority is not null;
create index if not exists idx_business_cards_user_tags
  on public.business_cards using gin (user_tags);

-- ---- 編集の変更履歴（0064の共通監査トリガー。取込が大量INSERTのためUPDATE/DELETEのみ） ----
drop trigger if exists trg_audit_business_cards on public.business_cards;
create trigger trg_audit_business_cards
  after update or delete on public.business_cards
  for each row execute function public.fn_audit_row();

-- ---- コメント（lead_comments と同設計） ----
create table if not exists public.business_card_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  card_id uuid not null references business_cards(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bc_comments_card on public.business_card_comments(card_id, created_at desc);

alter table public.business_card_comments enable row level security;

drop policy if exists bc_comments_select on public.business_card_comments;
drop policy if exists bc_comments_insert on public.business_card_comments;
drop policy if exists bc_comments_delete on public.business_card_comments;

create policy bc_comments_select on public.business_card_comments for select
  using (tenant_id in (select current_tenant_ids()));
create policy bc_comments_insert on public.business_card_comments for insert
  with check (tenant_id in (select current_tenant_ids()) and author_user_id = (select auth.uid()));
create policy bc_comments_delete on public.business_card_comments for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (author_user_id = (select auth.uid()) or current_role_in(tenant_id) in ('owner','admin'))
  );
