-- =====================================================================
-- 0127: 名刺情報（Eight等でスキャンした名刺を組織で共有し、CRMと連携）
--   個人ごとに名刺交換したデータ（owner_user_id=交換者）をテナント全員で
--   閲覧・検索できるようにする（Eightの組織共有プランと同等の思想）。
--   会社名・氏名・メールでCRM(accounts/contacts)とマッチングし、
--   名刺→顧客 / 顧客→名刺 の双方向で参照できる。
-- =====================================================================

-- ---- 正規化ヘルパー（会社名の法人格・空白除去 / 氏名の空白除去） ----
-- lead-import.ts の normCompany と同じ規則をSQL側にも持つ（マッチングはDBで実行）。
create or replace function public.norm_company_name(t text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(coalesce(t, ''),
        '(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|学校法人|医療法人|社会福祉法人|\(株\)|（株）|\(有\)|（有）|㈱|㈲)', '', 'g'),
      '[[:space:]　]', '', 'g'),
    '')
$$;

create or replace function public.norm_person_name(t text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(t, ''), '[[:space:]　]', '', 'g'), '')
$$;

-- ---- 名刺テーブル ----
create table if not exists public.business_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, -- 名刺交換者
  company_name text not null default '',
  department text,
  title text,                                        -- 役職
  full_name text not null default '',
  last_name text,
  first_name text,
  email text,
  postal_code text,
  address text,
  tel_company text,
  tel_department text,
  tel_direct text,
  fax text,
  mobile_phone text,
  url text,
  exchanged_on date,                                 -- 名刺交換日
  eight_connected boolean not null default false,    -- Eightでつながっている人
  rank text,                                         -- S/A/B/C/D 等（手入力の見込みランク）
  memo text,
  tags text[] not null default '{}',                 -- 展示会・交流会などのイベントタグ
  source text not null default 'eight',
  dedup_key text not null,                           -- 再取込時の重複防止キー（アプリで算出）
  -- CRM連携（マッチング結果 or 手動連携）
  account_id uuid references accounts(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  match_type text check (match_type in ('email','company_contact','company','manual')),
  matched_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_business_cards_dedup on public.business_cards(tenant_id, owner_user_id, dedup_key);
create index if not exists idx_business_cards_tenant_exchanged on public.business_cards(tenant_id, exchanged_on desc);
create index if not exists idx_business_cards_account on public.business_cards(account_id) where account_id is not null;
create index if not exists idx_business_cards_contact on public.business_cards(contact_id) where contact_id is not null;
create index if not exists idx_business_cards_company_norm on public.business_cards(norm_company_name(company_name));
create index if not exists idx_business_cards_email_lower on public.business_cards(lower(email)) where email is not null;
create trigger trg_business_cards_updated before update on public.business_cards
  for each row execute function public.set_updated_at();

-- マッチング相手側の検索を速くする式インデックス
create index if not exists idx_accounts_name_norm on public.accounts(norm_company_name(name));
create index if not exists idx_contacts_email_lower on public.contacts(lower(email)) where email is not null;

-- ---- RLS（名刺は「組織で共有」が目的のため、テナント内全員が閲覧可） ----
alter table public.business_cards enable row level security;

create policy business_cards_select on public.business_cards for select using (
  tenant_id in (select current_tenant_ids())
);
create policy business_cards_insert on public.business_cards for insert with check (
  tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
);
create policy business_cards_update on public.business_cards for update
  using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy business_cards_delete on public.business_cards for delete using (
  tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)
);

-- ---- マッチングRPC ----
-- 未連携の名刺をCRMと突合して自動連携する。優先度:
--   1) メール一致        → 担当者(contact)＋その顧客(account)
--   2) 会社名＋氏名一致  → 担当者＋顧客
--   3) 会社名一致        → 顧客のみ
-- security invoker（実行者のRLS適用）。手動連携(match_type='manual')は上書きしない。
create or replace function public.match_business_cards()
returns jsonb
language plpgsql volatile
set search_path = public
as $$
declare
  v_email int := 0;
  v_company_contact int := 0;
  v_company int := 0;
begin
  -- 1) メール一致
  with m as (
    select distinct on (bc.id) bc.id, c.id as contact_id, c.account_id
    from business_cards bc
    join contacts c
      on c.tenant_id = bc.tenant_id
     and c.email is not null
     and lower(c.email) = lower(bc.email)
    where bc.email is not null
      and bc.contact_id is null
      and bc.match_type is distinct from 'manual'
    order by bc.id, c.created_at
  ), upd as (
    update business_cards b
       set contact_id = m.contact_id,
           account_id = coalesce(m.account_id, b.account_id),
           match_type = 'email',
           matched_at = now()
      from m where b.id = m.id
    returning 1
  ) select count(*) into v_email from upd;

  -- 2) 会社名＋氏名一致
  with m as (
    select distinct on (bc.id) bc.id, c.id as contact_id, a.id as account_id
    from business_cards bc
    join accounts a
      on a.tenant_id = bc.tenant_id
     and a.deleted_at is null
     and norm_company_name(a.name) = norm_company_name(bc.company_name)
    join contacts c
      on c.account_id = a.id
     and norm_person_name(c.name) = norm_person_name(bc.full_name)
    where bc.contact_id is null
      and bc.match_type is distinct from 'manual'
      and norm_company_name(bc.company_name) is not null
      and norm_person_name(bc.full_name) is not null
    order by bc.id, c.created_at
  ), upd as (
    update business_cards b
       set contact_id = m.contact_id,
           account_id = m.account_id,
           match_type = 'company_contact',
           matched_at = now()
      from m where b.id = m.id
    returning 1
  ) select count(*) into v_company_contact from upd;

  -- 3) 会社名一致（顧客のみ連携）
  with m as (
    select distinct on (bc.id) bc.id, a.id as account_id
    from business_cards bc
    join accounts a
      on a.tenant_id = bc.tenant_id
     and a.deleted_at is null
     and norm_company_name(a.name) = norm_company_name(bc.company_name)
    where bc.account_id is null
      and bc.match_type is distinct from 'manual'
      and norm_company_name(bc.company_name) is not null
    order by bc.id, a.created_at
  ), upd as (
    update business_cards b
       set account_id = m.account_id,
           match_type = 'company',
           matched_at = now()
      from m where b.id = m.id
    returning 1
  ) select count(*) into v_company from upd;

  return jsonb_build_object(
    'email', v_email,
    'company_contact', v_company_contact,
    'company', v_company
  );
end $$;

revoke execute on function public.match_business_cards() from public, anon;
grant execute on function public.match_business_cards() to authenticated;
