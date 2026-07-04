-- WO-04: 研修後トランジション管理。研修/開発案件の受注後、温度感が高いうちにアップセルする導線。
create table if not exists public.transitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  original_opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  initial_product text,                 -- training/development/advisory/trial/other
  delivery_date date,
  target_department text,
  participant_count integer,
  satisfaction_score numeric,
  survey_summary text,
  outcomes text,
  next_solution_candidate_1 text,
  next_solution_candidate_2 text,
  next_solution_candidate_3 text,
  followup_3days_status text not null default 'not_started',   -- not_started/done/overdue
  followup_2weeks_status text not null default 'not_started',
  proposal_30days_status text not null default 'not_started',
  next_action_date date,
  next_action_text text,
  upsell_opportunity_id uuid references public.opportunities(id),
  status text not null default 'active',  -- active/converted/closed/on_hold
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.transitions enable row level security;
create policy tr_select on public.transitions for select
  using (tenant_id = any(array(select current_tenant_ids())));
create policy tr_insert on public.transitions for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy tr_update on public.transitions for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy tr_delete on public.transitions for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create trigger set_updated_at_transitions before update on public.transitions
  for each row execute function public.set_updated_at();
create index if not exists idx_transitions_account on public.transitions(tenant_id, account_id);
create unique index if not exists uq_transitions_orig on public.transitions(original_opportunity_id);
