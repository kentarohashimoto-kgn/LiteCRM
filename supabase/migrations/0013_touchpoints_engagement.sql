-- 顧客エンゲージメント基盤: 接点(touchpoints)・人単位の集計(person_engagement)・企業ロールアップ
create or replace function norm_company(p text) returns text language sql immutable as $$
  select replace(replace(replace(replace(
    regexp_replace(coalesce(p,''),
      '株式会社|有限会社|合同会社|一般社団法人|一般財団法人|学校法人|\(株\)|（株）|\(有\)|（有）|株\)','','g'),
    ' ',''),'　',''),'㈱',''),'㈲','')
$$;

create table if not exists touchpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text,
  company_norm text,
  account_id uuid references accounts(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  type text not null,
  weight int not null default 1,
  occurred_at date,
  source text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_tp_tenant on touchpoints(tenant_id);
create index if not exists idx_tp_email on touchpoints(tenant_id, lower(email));
create index if not exists idx_tp_company on touchpoints(tenant_id, company_norm);
create index if not exists idx_tp_lead on touchpoints(lead_id);

alter table touchpoints enable row level security;
create policy tp_select on touchpoints for select using (tenant_id in (select current_tenant_ids()));
create policy tp_ins on touchpoints for insert with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy tp_upd on touchpoints for update using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));
create policy tp_del on touchpoints for delete using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

create table if not exists person_engagement (
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  score int not null default 0,
  rank text,
  touch_count int not null default 0,
  types text[] not null default '{}',
  last_touch_at date,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, email)
);
alter table person_engagement enable row level security;
create policy pe_select on person_engagement for select using (tenant_id in (select current_tenant_ids()));

alter table accounts add column if not exists engagement_score int;
alter table accounts add column if not exists engagement_rank text;

create or replace function engagement_rank_of(p_score int) returns text language sql immutable as $$
  select case when p_score >= 30 then 'S' when p_score >= 15 then 'A' when p_score >= 7 then 'B' when p_score >= 3 then 'C' else 'D' end
$$;

create or replace function recompute_engagement(p_tenant uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tenant not in (select current_tenant_ids()) then
    return;
  end if;
  delete from person_engagement where tenant_id = p_tenant;
  insert into person_engagement (tenant_id, email, score, rank, touch_count, types, last_touch_at)
  select p_tenant, lower(email), sum(weight)::int, engagement_rank_of(sum(weight)::int),
         count(*)::int, array_agg(distinct type), max(occurred_at)
  from touchpoints where tenant_id = p_tenant and email is not null and email <> ''
  group by lower(email);
  update accounts a set engagement_score = sub.score, engagement_rank = engagement_rank_of(sub.score)
  from (select company_norm, sum(weight)::int as score from touchpoints
        where tenant_id = p_tenant and company_norm is not null and company_norm <> '' group by company_norm) sub
  where a.tenant_id = p_tenant and norm_company(a.name) = sub.company_norm;
end;
$$;
