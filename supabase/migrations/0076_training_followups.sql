-- 第11弾: BO-6 研修後フォローアップ(研修後FU)
-- 受注した研修案件を母数に、1/3/6ヶ月後のフォローアップMtgの日程調整・実施・
-- AI活用度の進化・業務課題・ソリューション提案・アップセルを追跡する。
-- 受注(won×training)が発生したらトリガーで自動的に1件追加される。

create table if not exists public.fu_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid unique references opportunities(id) on delete set null,
  account_name text not null,
  training_name text,
  won_date date not null default current_date, -- FU期日の基準日(受注日)
  status text not null default 'open',         -- open/done/skipped(対象外)
  assignee_user_id uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.fu_meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  case_id uuid not null references fu_cases(id) on delete cascade,
  round_months int not null,                        -- 1 / 3 / 6
  due_date date not null,
  schedule_status text not null default 'not_scheduled', -- not_scheduled/scheduled/done/skipped
  held_on date,
  ai_score int,          -- AI活用度(0-100点)。回を追うごとの進化を見る
  issues text,           -- 他の業務課題
  proposal_done boolean not null default false, -- 課題へのソリューション提案をしたか
  upsell_status text not null default 'none',   -- none/proposed/won
  notes text,
  created_at timestamptz not null default now(),
  unique (case_id, round_months)
);
create index if not exists idx_fu_meetings_due on public.fu_meetings(due_date);

-- RLS: BO領域(事務/人事/管理者)
do $$
declare t text;
begin
  foreach t in array array['fu_cases','fu_meetings'] loop
    execute format('alter table public.%1$s enable row level security;
      create policy %1$s_all on public.%1$s for all
      using (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id))
      with check (tenant_id in (select current_tenant_ids()) and is_backoffice(tenant_id));', t);
  end loop;
end $$;

-- ケース+3回分のMtgを作る共通関数
create or replace function public.fn_fu_seed_case(
  p_tenant uuid, p_opp uuid, p_account text, p_training text, p_base date
) returns void
language plpgsql security definer set search_path = public
as $$
declare cid uuid;
begin
  if p_opp is not null and exists (select 1 from fu_cases where opportunity_id = p_opp) then
    return;
  end if;
  insert into fu_cases (tenant_id, opportunity_id, account_name, training_name, won_date)
  values (p_tenant, p_opp, p_account, p_training, coalesce(p_base, current_date))
  returning id into cid;
  insert into fu_meetings (tenant_id, case_id, round_months, due_date)
  select p_tenant, cid, m, coalesce(p_base, current_date) + (m || ' month')::interval
  from unnest(array[1, 3, 6]) as m;
end $$;

-- 受注×研修になったら自動でFUケースを追加(営業ユーザーの操作でもRLSを越えて作成できるようsecurity definer)
create or replace function public.fn_fu_on_opportunity_won()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare acc text;
begin
  select a.name into acc from accounts a where a.id = new.account_id;
  perform fn_fu_seed_case(new.tenant_id, new.id, coalesce(acc, '(会社名不明)'), new.name,
    coalesce(new.expected_close_date, current_date));
  return new;
end $$;

drop trigger if exists trg_fu_on_opportunity_won on public.opportunities;
create trigger trg_fu_on_opportunity_won
after insert or update of status, category on public.opportunities
for each row
when (new.status = 'won' and new.category = 'training' and new.deleted_at is null)
execute function public.fn_fu_on_opportunity_won();

-- 既存の受注×研修案件(現在の母数)をバックフィル
do $$
declare r record;
begin
  for r in
    select o.tenant_id, o.id, coalesce(a.name, '(会社名不明)') as account_name, o.name,
           coalesce(o.expected_close_date, current_date) as base
    from opportunities o
    left join accounts a on a.id = o.account_id
    where o.status = 'won' and o.category = 'training' and o.deleted_at is null
  loop
    perform fn_fu_seed_case(r.tenant_id, r.id, r.account_name, r.name, r.base);
  end loop;
end $$;
