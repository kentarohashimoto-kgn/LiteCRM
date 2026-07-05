-- 第9-10弾: BO-2 事例・インタビュー / BO-3 講師アンケート / BO-5 人材タレント(HR)
-- (docs/BACKOFFICE_DESIGN_2026-07.md。v1では研修種類・講師はテキスト項目で運用し、マスタ化は運用後に判断)

-- ---- BO-2 事例・インタビュー ----
create table if not exists public.case_studies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null,
  account_name text not null,
  training_name text,
  status text not null default 'not_approached', -- not_approached/approaching/agreed/interviewed/writing/published/declined
  assignee_user_id uuid references auth.users(id),
  approached_at date,
  interview_date date,
  published_url text,
  next_action_date date,
  notes text,
  created_at timestamptz not null default now()
);

-- ---- BO-3 講師アンケート ----
create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  held_on date not null,
  course text not null,      -- 研修種類
  instructor text not null,  -- 講師名
  account_name text,
  attendee_count int,
  created_at timestamptz not null default now()
);

create table if not exists public.training_survey_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  session_id uuid not null references training_sessions(id) on delete cascade,
  role_level text,   -- exec/manager/staff
  job_category text,
  age_band text,
  satisfaction int,      -- 1-5
  understanding int,     -- 1-5
  instructor_score int,  -- 1-5
  nps int,               -- 0-10
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tsr_session on public.training_survey_responses(session_id);

-- ---- BO-5 人材タレント(人事のみ) ----
create table if not exists public.job_openings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null default 'internal', -- client/internal
  title text not null,
  client_name text,
  role_description text,
  status text not null default 'open', -- open/interviewing/filled/closed
  rate_note text,
  opened_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  job_opening_id uuid references job_openings(id) on delete set null,
  name text not null,
  email text,
  source text,
  status text not null default 'applied', -- applied/screening/first/second/final/offer/joined/rejected/declined
  next_interview_at timestamptz,
  assignee_user_id uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  step text not null default 'first', -- screening/first/second/final
  scheduled_at timestamptz,
  interviewer text,
  result text, -- pass/fail/hold
  score int,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.talents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  candidate_id uuid references candidates(id) on delete set null,
  name text not null,
  employment_type text not null default 'employee', -- employee/contractor/instructor
  skills text,
  current_assignment text,
  joined_on date,
  left_on date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.talent_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  talent_id uuid not null references talents(id) on delete cascade,
  period text not null,          -- 例 2026H2 / 2026Q3
  reviewer text,
  overall int,                   -- 1-5
  comment text,
  goals text,
  created_at timestamptz not null default now()
);

-- ---- RLS ----
do $$
declare t text;
begin
  foreach t in array array['case_studies','training_sessions','training_survey_responses'] loop
    execute format('alter table public.%1$s enable row level security;
      create policy %1$s_all on public.%1$s for all
      using (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id))
      with check (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id));', t);
  end loop;
  foreach t in array array['job_openings','candidates','interviews','talents','talent_reviews'] loop
    execute format('alter table public.%1$s enable row level security;
      create policy %1$s_all on public.%1$s for all
      using (tenant_id in (select current_tenant_ids()) and is_hr(tenant_id))
      with check (tenant_id in (select current_tenant_ids()) and is_hr(tenant_id));', t);
  end loop;
end $$;
