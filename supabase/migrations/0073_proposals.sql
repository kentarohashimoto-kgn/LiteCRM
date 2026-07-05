-- 提案書管理: デフォルトは「提案書なしで成約」。開発案件・大型案件など
-- 提案が必要と見極めた案件だけフラグを立て、進捗・期限・提出バージョンを管理する。
--   - opportunities.proposal_required: 提案書の要否フラグ(既定 false)
--   - opportunities.proposal_status:   not_started / drafting / submitted / revising
--   - opportunities.proposal_due_date: 提出期限(リマインド対象)
--   - proposal_versions: 提出した提案書の履歴(URL or 添付ファイル)。最新 = version最大

alter table public.opportunities
  add column if not exists proposal_required boolean not null default false,
  add column if not exists proposal_status text,
  add column if not exists proposal_due_date date;

comment on column public.opportunities.proposal_required is '提案書が必要な案件か(既定false=提案書なしで成約を狙う)';
comment on column public.opportunities.proposal_status is '提案書の進捗(not_started/drafting/submitted/revising)';

create index if not exists idx_opps_proposal
  on public.opportunities(tenant_id, proposal_due_date) where proposal_required;

create table if not exists public.proposal_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  version int not null,
  title text,
  url text,
  file_name text,
  storage_path text,
  note text,
  submitted_at date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(opportunity_id, version)
);

create index if not exists idx_proposal_versions_opp on public.proposal_versions(opportunity_id, version desc);

alter table public.proposal_versions enable row level security;

-- 参照は「その案件が見える人」(opportunitiesのRLSを継承。ゴミ箱入り案件の版も自動的に不可視)
create policy proposal_versions_select on public.proposal_versions for select
  using (exists (select 1 from opportunities o where o.id = opportunity_id));
create policy proposal_versions_write on public.proposal_versions for insert
  with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy proposal_versions_delete on public.proposal_versions for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (created_by = auth.uid() or current_role_in(tenant_id) in ('owner','admin'))
  );

-- 既存アラート「A/commitヨミで提案なし」を新方式にも対応:
-- 提案書バージョンが1件でも提出済みなら「提案あり」とみなす
CREATE OR REPLACE FUNCTION public.sales_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid[] := array(select current_tenant_ids());
  result jsonb;
begin
  with o as materialized (
    select id, account_id, owner_user_id, name, status, yomi, next_action_date,
           budget_status, proposal_doc_url, proposed_solution, lost_reason, reapproach_date
    from opportunities where tenant_id = any(v) and deleted_at is null
  ),
  a as materialized (
    select id, owner_user_id, name, rank, last_activity_date
    from accounts where tenant_id = any(v) and deleted_at is null
  ),
  alerts as (
    select 'ac_overdue' as kind, 0 as sev, o.account_id, o.id as opportunity_id, o.name as opportunity_name,
           o.owner_user_id, o.next_action_date as due_date
    from o where o.status='open' and o.next_action_date is not null and o.next_action_date < current_date
    union all
    select 'ac_missing', 1, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='open' and o.next_action_date is null
    union all
    select 'budget_unknown_b', 1, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='open' and yomi_stage(o.yomi) in ('B','A','commit')
      and (o.budget_status is null or o.budget_status='unknown')
    union all
    select 'no_proposal_a', 1, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='open' and yomi_stage(o.yomi) in ('A','commit')
      and o.proposal_doc_url is null and o.proposed_solution is null
      and not exists (select 1 from proposal_versions pv where pv.opportunity_id = o.id)
    union all
    select 'lost_no_reason', 2, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='lost' and o.lost_reason is null
    union all
    select 'no_reapproach', 2, o.account_id, o.id, o.name, o.owner_user_id, null
    from o where o.status='lost' and o.reapproach_date is null
      and (o.lost_reason is null or o.lost_reason not like '[再アプローチ不要]%')
    union all
    select 's_account_stale', 1, a.id, null, a.name, a.owner_user_id, a.last_activity_date
    from a where a.rank='S' and (a.last_activity_date is null or a.last_activity_date < current_date - 30)
    union all
    select 'a_account_stale', 2, a.id, null, a.name, a.owner_user_id, a.last_activity_date
    from a where a.rank='A' and (a.last_activity_date is null or a.last_activity_date < current_date - 60)
    union all
    select 'proposal_followup_7d', 0, t.account_id, t.opportunity_id, t.title, t.assigned_to, t.due_date
    from tasks t
    where t.tenant_id = any(v) and t.origin='followup7d' and t.status <> 'done'
      and t.due_date is not null and t.due_date < current_date
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', al.kind,
      'severity', case al.sev when 0 then 'high' when 1 then 'mid' else 'low' end,
      'account_id', al.account_id,
      'account_name', a2.name,
      'opportunity_id', al.opportunity_id,
      'opportunity_name', al.opportunity_name,
      'owner_user_id', al.owner_user_id,
      'due_date', al.due_date
    ) order by al.sev, al.due_date nulls last
  ), '[]'::jsonb) into result
  from alerts al
  left join a a2 on a2.id = al.account_id;
  return result;
end $function$;
