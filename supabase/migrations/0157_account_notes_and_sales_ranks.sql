-- =====================================================================
-- 顧客メモ(account_notes) ＋ 売上ベースのランク自動付与
--   1) 顧客に紐づく「顧客メモ」を保持するテーブル。顧客詳細画面に表示する。
--      AIリサーチ(Gmail/Calendar/Notion横断のやりとりまとめ・満足度/業務課題
--      解決度の10段階評価・アップセル/クロスセル戦略提言)もこのメモに挿入する。
--   2) 売上(受注=won商談)に基づくランク自動付与のための関数。
--      B: 受注1件以上 / A: 案件2件以上 かつ 受注2件以上。
-- =====================================================================

create table if not exists public.account_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  title text,
  body text not null default '',
  -- general: 手入力メモ / ai_research: AIによる顧客分析(満足度・ポテンシャル・戦略)
  kind text not null default 'general',
  -- 現状の満足度(カトルセに対する)10段階。ai_research のみ設定。
  satisfaction_score int check (satisfaction_score between 0 and 10),
  -- AI活用/業務改善ポテンシャル(業務課題解決度)10段階。ai_research のみ設定。
  potential_score int check (potential_score between 0 and 10),
  -- 参照ソース(例: Gmail 12件 / Calendar 4件 / Notion 3件)の控え
  source_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_account_notes_account
  on public.account_notes(account_id, created_at desc);

drop trigger if exists set_updated_at_account_notes on public.account_notes;
create trigger set_updated_at_account_notes
  before update on public.account_notes
  for each row execute function public.set_updated_at();

alter table public.account_notes enable row level security;

-- 参照は同一テナント
drop policy if exists account_notes_select on public.account_notes;
create policy account_notes_select on public.account_notes for select
  using (tenant_id in (select current_tenant_ids()));

-- 追加は同一テナント（作成者は本人 or サーバ側でnull許容）
drop policy if exists account_notes_insert on public.account_notes;
create policy account_notes_insert on public.account_notes for insert
  with check (
    tenant_id in (select current_tenant_ids())
    and (author_user_id is null or author_user_id = auth.uid())
  );

-- 更新は同一テナントの編集権限保有者
drop policy if exists account_notes_update on public.account_notes;
create policy account_notes_update on public.account_notes for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- 削除は作成者 or 管理者
drop policy if exists account_notes_delete on public.account_notes;
create policy account_notes_delete on public.account_notes for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (author_user_id = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );

-- ---------------------------------------------------------------------
-- 売上ベースのランク自動付与
--   受注(status='won')の実績からランクを算出し accounts.rank を更新する。
--   ・B: 受注1件以上
--   ・A: 案件2件以上 かつ 受注2件以上
--   受注実績のない顧客の rank は変更しない(手動ランク/未設定を保持)。
--   テナント単位で実行(デモテナントを巻き込まないため)。
-- ---------------------------------------------------------------------
create or replace function public.apply_sales_ranks(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with agg as (
    select a.id,
      count(o.id) as opp_count,
      count(o.id) filter (where o.status = 'won') as won_count
    from accounts a
    join opportunities o on o.account_id = a.id and o.tenant_id = p_tenant
    where a.tenant_id = p_tenant and a.deleted_at is null
    group by a.id
    having count(o.id) filter (where o.status = 'won') >= 1
  ),
  upd as (
    update accounts a
      set rank = case
                   when g.won_count >= 2 and g.opp_count >= 2 then 'A'
                   else 'B'
                 end,
          updated_at = now()
    from agg g
    where a.id = g.id
    returning a.id
  )
  select count(*) into n from upd;
  return n;
end;
$$;
