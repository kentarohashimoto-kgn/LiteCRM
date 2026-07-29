-- =====================================================================
-- 0177: リードの「対応者(FS接客者)」判定 — 名刺連携 × メモ記載の複合条件
--   運用背景: 展示会では ①獲得担当がQRスキャンで個人情報を取得 →
--   ②社長/責任者(橋本)がFS接客し名刺交換 という2段構えのため、
--   「誰が接客したか」は acquirer(獲得担当) では表せない。
--   判定は (メモにパターン一致) OR (その人の名刺と一致) の複合ルール。
--   責任者接客リードは商談化率が高い前提のため、Fitスコアにも加点する。
--
--   1) business_cards.lead_id を埋めるマッチングRPC(メール→会社+氏名)
--   2) leads.handled_by / handled_by_source(判定根拠。manualは手修正で保護)
--   3) lead_handler_rules(担当者ごとの判定ルール) + 橋本ルールのシード
--   4) assign_lead_handlers() 判定RPC
--   5) スコア軸「責任者接客」+ match_kind 'handled_by_in' を rescore_leads に追加
-- =====================================================================

-- ---- 2) リードの対応者 ----
alter table public.leads
  add column if not exists handled_by text,          -- 対応者の表示名(例: 橋本 健太郎)
  add column if not exists handled_by_source text;   -- 'memo'|'card'|'both'|'manual'(手修正は再判定で保護)
create index if not exists idx_leads_handled_by on public.leads(tenant_id, handled_by) where handled_by is not null;

-- ---- 3) 対応者の判定ルール ----
create table if not exists public.lead_handler_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  handler_name text not null,                 -- 対応者の表示名(leads.handled_by に入る値)
  memo_pattern text,                          -- メモの一致パターン(正規表現。例: '橋')
  memo_exclude text,                          -- 除外パターン(例: 'セミナーを聞いて')
  card_owner_user_id uuid references auth.users(id) on delete set null,  -- この人の名刺と一致したら該当
  card_from date,                             -- 名刺交換日の下限(古い知人を除くため)
  priority int not null default 100,          -- 小さいほど優先(複数ルール該当時)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_lead_handler_rules_tenant on public.lead_handler_rules(tenant_id, priority);
create trigger trg_lead_handler_rules_updated before update on public.lead_handler_rules
  for each row execute function public.set_updated_at();
alter table public.lead_handler_rules enable row level security;
create policy lhr_select on public.lead_handler_rules for select using (tenant_id in (select current_tenant_ids()));
create policy lhr_write on public.lead_handler_rules for all using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- 橋本ルールのシード(実データ検証: メモ「橋」187件・誤爆0件 / 名刺一致517件)
insert into public.lead_handler_rules (tenant_id, handler_name, memo_pattern, memo_exclude, card_owner_user_id, card_from, priority, is_active)
select t.id, p.display_name, '橋', 'セミナーを聞いて', p.id, '2026-01-01'::date, 10, true
from public.tenants t
join public.profiles p on p.email = 'kentaro.hashimoto@catorce.jp'
where t.is_demo = false
  and not exists (select 1 from public.lead_handler_rules r where r.tenant_id = t.id);

-- ---- 1) 名刺 ⇔ リード のマッチング ----
--   ①メール完全一致 ②会社名(正規化)+氏名(空白除去)一致 の順。既に紐付け済みは触らない。
create or replace function public.match_cards_to_leads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  n_email int := 0;
  n_name int := 0;
begin
  -- ① メール一致(1名刺につき最新のリード1件)
  with cand as (
    select distinct on (c.id) c.id as card_id, l.id as lead_id
    from business_cards c
    join leads l on l.tenant_id = c.tenant_id and lower(l.email) = lower(c.email)
    where c.tenant_id = any(v) and c.lead_id is null
      and coalesce(c.email, '') <> '' and coalesce(l.email, '') <> ''
    order by c.id, l.acquired_at desc nulls last, l.id
  )
  update business_cards c set lead_id = cand.lead_id
  from cand where c.id = cand.card_id;
  get diagnostics n_email = row_count;

  -- ② 会社名+氏名 一致(メールが無い名刺の救済)
  with cand as (
    select distinct on (c.id) c.id as card_id, l.id as lead_id
    from business_cards c
    join leads l on l.tenant_id = c.tenant_id
      and norm_company_name(l.company_name) = norm_company_name(c.company_name)
      and norm_person_name(l.contact_name) = norm_person_name(c.full_name)
    where c.tenant_id = any(v) and c.lead_id is null
      and coalesce(c.company_name, '') <> '' and coalesce(c.full_name, '') <> ''
    order by c.id, l.acquired_at desc nulls last, l.id
  )
  update business_cards c set lead_id = cand.lead_id
  from cand where c.id = cand.card_id;
  get diagnostics n_name = row_count;

  return jsonb_build_object('byEmail', n_email, 'byName', n_name);
end;
$$;
revoke execute on function public.match_cards_to_leads() from public, anon;
grant execute on function public.match_cards_to_leads() to authenticated;

-- ---- 4) 対応者の判定 ----
--   (メモ一致 OR 名刺一致) で該当。手修正(handled_by_source='manual')は保護。
--   名刺の照合は lead_id 紐付け済み(①)に加え、メールの直接一致も見る(未マッチ救済)。
create or replace function public.assign_lead_handlers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  n int := 0;
  n_cleared int := 0;
begin
  with hits as (
    select
      l.id as lead_id,
      r.handler_name,
      r.priority,
      -- 判定根拠
      (r.memo_pattern is not null and r.memo_pattern <> ''
        and coalesce(l.notes, '') ~ r.memo_pattern
        and (coalesce(r.memo_exclude, '') = '' or coalesce(l.notes, '') !~ r.memo_exclude)) as by_memo,
      exists (
        select 1 from business_cards c
        where c.tenant_id = l.tenant_id
          and r.card_owner_user_id is not null
          and c.owner_user_id = r.card_owner_user_id
          and (r.card_from is null or c.exchanged_on >= r.card_from)
          and (c.lead_id = l.id
               or (coalesce(c.email, '') <> '' and coalesce(l.email, '') <> '' and lower(c.email) = lower(l.email)))
      ) as by_card
    from leads l
    join lead_handler_rules r on r.tenant_id = l.tenant_id and r.is_active
    where l.tenant_id = any(v)
      and coalesce(l.handled_by_source, '') <> 'manual'
  ),
  matched as (
    select distinct on (lead_id) lead_id, handler_name,
      case when by_memo and by_card then 'both' when by_memo then 'memo' else 'card' end as src
    from hits
    where by_memo or by_card
    order by lead_id, priority, handler_name
  ),
  upd as (
    update leads l set handled_by = m.handler_name, handled_by_source = m.src
    from matched m where l.id = m.lead_id
      and (l.handled_by is distinct from m.handler_name or l.handled_by_source is distinct from m.src)
    returning 1
  )
  select count(*) into n from upd;

  -- ルール変更で該当しなくなった自動判定分はクリア(手修正は残す)
  update leads l set handled_by = null, handled_by_source = null
  where l.tenant_id = any(v)
    and l.handled_by is not null
    and coalesce(l.handled_by_source, '') in ('memo', 'card', 'both')
    and not exists (
      select 1 from lead_handler_rules r
      where r.tenant_id = l.tenant_id and r.is_active and r.handler_name = l.handled_by
        and (
          (r.memo_pattern is not null and r.memo_pattern <> ''
            and coalesce(l.notes, '') ~ r.memo_pattern
            and (coalesce(r.memo_exclude, '') = '' or coalesce(l.notes, '') !~ r.memo_exclude))
          or exists (
            select 1 from business_cards c
            where c.tenant_id = l.tenant_id and r.card_owner_user_id is not null
              and c.owner_user_id = r.card_owner_user_id
              and (r.card_from is null or c.exchanged_on >= r.card_from)
              and (c.lead_id = l.id
                   or (coalesce(c.email, '') <> '' and coalesce(l.email, '') <> '' and lower(c.email) = lower(l.email)))
          )
        )
    );
  get diagnostics n_cleared = row_count;

  return jsonb_build_object('assigned', n, 'cleared', n_cleared);
end;
$$;
revoke execute on function public.assign_lead_handlers() from public, anon;
grant execute on function public.assign_lead_handlers() to authenticated;

-- ---- 5) スコア: 「責任者接客」軸を追加し、rescore_leads に handled_by_in を実装 ----
insert into public.lead_scoring_axes (tenant_id, axis, label, cap, agg, sort_order)
select t.id, 'exec_touch', '責任者接客（社長・責任者が対応）', 15, 'max', 7
from public.tenants t where t.is_demo = false
on conflict (tenant_id, axis) do nothing;

insert into public.lead_scoring_rules (tenant_id, axis, label, match_kind, match_value, points, sort_order, is_active)
select t.id, 'exec_touch', '社長・責任者が接客したリード', 'handled_by_in', p.display_name, 15, 1, true
from public.tenants t
join public.profiles p on p.email = 'kentaro.hashimoto@catorce.jp'
where t.is_demo = false
  and not exists (select 1 from public.lead_scoring_rules r where r.tenant_id = t.id and r.axis = 'exec_touch');

create or replace function public.rescore_leads(p_lead_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  n integer;
begin
  with base as materialized (
    select l.id, l.tenant_id, l.rank,
      (select coalesce(max((m[1])::int), 0) from regexp_matches(coalesce(l.employee_size,''), '([0-9]+)', 'g') as m) as emp_num,
      coalesce(l.role_level,'') as role_level, coalesce(l.job_title,'') as job_title,
      coalesce(l.industry,'') as industry,
      coalesce(l.needs,'') as needs, coalesce(l.timing,'') as timing, coalesce(l.budget_band,'') as budget_band,
      coalesce(l.handled_by,'') as handled_by,
      (coalesce(l.needs,'') || ' ' || coalesce(l.notes,'') || ' ' || coalesce(l.tags::text,'')) as fulltext
    from leads l
    where l.tenant_id = any(v) and (p_lead_id is null or l.id = p_lead_id)
  ),
  hits as (
    select b.id as lead_id, b.tenant_id, r.axis, r.points
    from base b
    join lead_scoring_rules r on r.tenant_id = b.tenant_id and r.is_active
    where case r.match_kind
      when 'employee_gte'      then b.emp_num >= coalesce(nullif(regexp_replace(r.match_value,'[^0-9]','','g'),'')::int, 0)
      when 'role_level_in'     then b.role_level <> '' and b.role_level = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'title_regex'       then b.job_title <> '' and b.job_title ~ r.match_value
      when 'industry_includes' then b.industry <> '' and b.industry ~ r.match_value
      when 'needs_in'          then b.needs <> '' and b.needs = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'timing_in'         then b.timing <> '' and b.timing = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'budget_in'         then b.budget_band <> '' and b.budget_band = any(string_to_array(replace(r.match_value,' ',''), ','))
      when 'text_includes'     then b.fulltext ~ r.match_value
      when 'handled_by_in'     then b.handled_by <> '' and b.handled_by = any(string_to_array(r.match_value, ','))
      else false end
  ),
  per_axis as (
    select h.lead_id, h.tenant_id, h.axis,
      least(a.cap, case when a.agg = 'sum' then sum(h.points) else max(h.points) end)::int as pts
    from hits h
    join lead_scoring_axes a on a.tenant_id = h.tenant_id and a.axis = h.axis
    group by h.lead_id, h.tenant_id, h.axis, a.cap, a.agg
  ),
  caps as (
    select a.tenant_id, sum(a.cap)::int as total_cap
    from lead_scoring_axes a
    where exists (select 1 from lead_scoring_rules r where r.tenant_id = a.tenant_id and r.axis = a.axis and r.is_active)
    group by a.tenant_id
  ),
  totals as (
    select b.id, b.rank, b.tenant_id,
      coalesce((select sum(pa.pts) from per_axis pa where pa.lead_id = b.id), 0) as raw,
      coalesce((select jsonb_object_agg(pa.axis, pa.pts) from per_axis pa where pa.lead_id = b.id), '{}'::jsonb) as detail
    from base b
  ),
  final as (
    select t.id, t.rank, t.detail, t.raw,
      case when coalesce(c.total_cap, 0) > 0
        then least(100, round(100.0 * t.raw / c.total_cap))::int
        else 0 end as score
    from totals t left join caps c on c.tenant_id = t.tenant_id
  )
  update leads l set
    lead_score = f.score,
    lead_score_detail = f.detail || jsonb_build_object(
      'raw', f.raw,
      'auto_rank', case when f.score >= 80 then 'S' when f.score >= 65 then 'A' when f.score >= 50 then 'B' when f.score >= 35 then 'C' else 'D' end
    ),
    rank = coalesce(nullif(l.rank, ''), case when f.score >= 80 then 'S' when f.score >= 65 then 'A' when f.score >= 50 then 'B' when f.score >= 35 then 'C' else 'D' end)
  from final f
  where l.id = f.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.rescore_leads(uuid) from public, anon;
grant execute on function public.rescore_leads(uuid) to authenticated;

-- ---- 対応者の選択肢(一覧フィルタ用) ----
create or replace function public.lead_handlers()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', handled_by, 'leads', n) order by n desc), '[]'::jsonb)
  from (
    select handled_by, count(*)::int as n
    from leads
    where tenant_id in (select current_tenant_ids()) and coalesce(handled_by, '') <> ''
    group by handled_by
  ) x
$$;
revoke execute on function public.lead_handlers() from public, anon;
grant execute on function public.lead_handlers() to authenticated;
