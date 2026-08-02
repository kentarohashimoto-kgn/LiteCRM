-- =====================================================================
-- メモ・議事録ページ（Notionライクな自由ページ）
--
--   目的:
--     ① トップ画面(マイページ/ナビ/クイック追加)から1クリックで白紙ページを作り、
--        メモ・議事録をすぐに書き始められるようにする。
--     ② 議事録は録音でも取得可能（既存の meeting_recordings ＋夜間文字起こしを再利用。
--        録音に memo_page_id を持たせ、文字起こし完了時に本文が空ならページへ反映）。
--     ③ ページは後から CRM の案件(opportunities)・商談(meetings)に紐付けられる。
--
--   モデル: memo_pages（parent_id の自己参照でサブページ＝Notion的な階層）
--          meeting_recordings.memo_page_id（録音をページに紐付け）
--
--   権限: テナント内の全メンバーで共有（ノウハウ・事例と同じ思想。
--        議事録は案件に紐付けてチームで参照するため、個人秘匿にはしない）。
--        削除のみ 作成者本人 または owner/admin。
-- =====================================================================

create table if not exists public.memo_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- サブページ。親を消してもサブページは残す(トップ階層へ昇格)。
  parent_id uuid references memo_pages(id) on delete set null,
  title text not null default '',
  -- 本文はプレーンテキスト(見出し・箇条書きは書式なしで自由に)。自動保存。
  body text not null default '',
  -- memo=メモ / minutes=議事録（テンプレート・録音導線の出し分けに使う）
  kind text not null default 'memo' check (kind in ('memo','minutes')),
  -- 後から紐付けるCRM参照。案件/商談/顧客のどれか(または複数)を任意で。
  opportunity_id uuid references opportunities(id) on delete set null,
  meeting_id uuid references meetings(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  owner_user_id uuid not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memo_pages_tenant on public.memo_pages(tenant_id, updated_at desc);
create index if not exists idx_memo_pages_parent on public.memo_pages(parent_id);
create index if not exists idx_memo_pages_opp on public.memo_pages(opportunity_id);
create index if not exists idx_memo_pages_meeting on public.memo_pages(meeting_id);

drop trigger if exists trg_memo_pages_updated on public.memo_pages;
create trigger trg_memo_pages_updated before update on public.memo_pages
  for each row execute function public.set_updated_at();

alter table public.memo_pages enable row level security;

-- 参照/作成/更新: テナント内メンバー（共同編集を許可）
drop policy if exists memo_pages_select on public.memo_pages;
create policy memo_pages_select on public.memo_pages for select
  using (tenant_id in (select current_tenant_ids()));
drop policy if exists memo_pages_insert on public.memo_pages;
create policy memo_pages_insert on public.memo_pages for insert
  with check (tenant_id in (select current_tenant_ids()) and owner_user_id = auth.uid());
drop policy if exists memo_pages_update on public.memo_pages;
create policy memo_pages_update on public.memo_pages for update
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
-- 削除: 作成者本人 or 管理者
drop policy if exists memo_pages_delete on public.memo_pages;
create policy memo_pages_delete on public.memo_pages for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (owner_user_id = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );

-- 録音をメモページに紐付ける（案件・商談なしでもページ単体で録音できる）。
-- ページ削除時は録音行を残す(set null)。実体の後始末はアプリ側の削除アクションが行う。
alter table public.meeting_recordings
  add column if not exists memo_page_id uuid references public.memo_pages(id) on delete set null;
create index if not exists idx_mrec_memo_page on public.meeting_recordings(memo_page_id);
