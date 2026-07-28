-- =====================================================================
-- 0174: Fitスコアのルール化(設計画面で編集可能に) + 開封判定の精度改善
--   1) lead_scoring_axes / lead_scoring_rules … スコアの軸・ルールをデータ化
--      (従来 0050 のハードコード実装を、同一結果になるシードでルール駆動へ移行)
--   2) rescore_leads() をルール駆動に差し替え(呼出側は無変更)
--      スコアは「有効ルールを持つ軸のcap合計」で0-100に正規化。手動rank保護は維持。
--   3) 開封/クリック集計の精度改善: 送信後60秒以内のイベントは
--      セキュリティスキャナ/プロキシ先読みとみなし、開封率・スコアから除外。
-- =====================================================================

-- ---- 1) スコア軸(cap・集計方法) ----
create table if not exists public.lead_scoring_axes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  axis text not null,                 -- 'size'|'role'|'needs'|'timing'|'budget'|'industry_fit'|'custom'
  label text not null,
  cap int not null default 20,        -- 軸の上限点
  agg text not null default 'max',    -- 'max'(段階判定: 従業員数バンド等) | 'sum'(加点式: 相性キーワード等)
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, axis)
);
create trigger trg_lead_scoring_axes_updated before update on public.lead_scoring_axes
  for each row execute function public.set_updated_at();
alter table public.lead_scoring_axes enable row level security;
create policy lsa_select on public.lead_scoring_axes for select using (tenant_id in (select current_tenant_ids()));
create policy lsa_write on public.lead_scoring_axes for all using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- 1) スコアルール ----
create table if not exists public.lead_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  axis text not null,
  label text not null,
  match_kind text not null,   -- 'employee_gte'|'role_level_in'|'title_regex'|'industry_includes'|'needs_in'|'timing_in'|'budget_in'|'text_includes'
  match_value text not null,
  points int not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_lead_scoring_rules_tenant on public.lead_scoring_rules(tenant_id, axis, sort_order);
create trigger trg_lead_scoring_rules_updated before update on public.lead_scoring_rules
  for each row execute function public.set_updated_at();
alter table public.lead_scoring_rules enable row level security;
create policy lsr_select on public.lead_scoring_rules for select using (tenant_id in (select current_tenant_ids()));
create policy lsr_write on public.lead_scoring_rules for all using (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id)) with check (tenant_id in (select current_tenant_ids()) and can_edit_role(tenant_id));

-- ---- シード(非デモテナント): 0050の実装と同一結果になる初期値 ----
insert into public.lead_scoring_axes (tenant_id, axis, label, cap, agg, sort_order)
select t.id, v.axis, v.label, v.cap, v.agg, v.sort_order
from public.tenants t,
  (values
    ('size',         '規模（従業員数）',        20, 'max', 1),
    ('role',         '役職',                    20, 'max', 2),
    ('needs',        '課題の温度感',            25, 'max', 3),
    ('timing',       '導入時期',                15, 'max', 4),
    ('budget',       '予算',                    20, 'max', 5),
    ('industry_fit', '業界・職種の相性',        15, 'sum', 6)
  ) as v(axis, label, cap, agg, sort_order)
where t.is_demo = false
on conflict (tenant_id, axis) do nothing;

insert into public.lead_scoring_rules (tenant_id, axis, label, match_kind, match_value, points, sort_order, is_active)
select t.id, v.axis, v.label, v.match_kind, v.match_value, v.points, v.sort_order, v.is_active
from public.tenants t,
  (values
    -- 規模(バンド判定=max)
    ('size', '従業員1,000名以上', 'employee_gte', '1000', 20, 1, true),
    ('size', '従業員300名以上',   'employee_gte', '300',  15, 2, true),
    ('size', '従業員100名以上',   'employee_gte', '100',  10, 3, true),
    ('size', '従業員30名以上',    'employee_gte', '30',    5, 4, true),
    ('size', '従業員数の記載あり', 'employee_gte', '1',     2, 5, true),
    -- 役職(役職レベル + 役職名パターン)
    ('role', '経営層（社長・役員）',   'role_level_in', 'exec,officer', 20, 1, true),
    ('role', '部課長クラス',           'role_level_in', 'manager',      10, 2, true),
    ('role', '役職名に決裁キーワード', 'title_regex',   '社長|代表|CEO|CTO|CIO|役員|取締役|本部長', 20, 3, false),
    -- 課題
    ('needs', '課題感が強い', 'needs_in', 'high', 25, 1, true),
    ('needs', '課題感が中',   'needs_in', 'mid',  12, 2, true),
    -- 時期
    ('timing', '今すぐ（1-3ヶ月）', 'timing_in', 'now',  15, 1, true),
    ('timing', '近々（半年以内）',   'timing_in', 'soon', 10, 2, true),
    -- 予算
    ('budget', '予算あり',   'budget_in', 'yes',         20, 1, true),
    ('budget', '予算検討中', 'budget_in', 'considering', 10, 2, true),
    -- 業界・職種の相性(加点式=sum。初期は例としてOFF。設計画面でONにして使う)
    ('industry_fit', '例: AI導入・生成AIに言及',   'text_includes',     'AI導入|生成AI|ChatGPT', 8, 1, false),
    ('industry_fit', '例: 研修・人材育成ニーズ',   'text_includes',     '研修|人材育成',          6, 2, false),
    ('industry_fit', '例: 情報システム部門',       'text_includes',     '情シス|情報システム',    6, 3, false),
    ('industry_fit', '例: 製造業',                 'industry_includes', '製造',                   5, 4, false),
    ('industry_fit', '例: IT・情報通信業',         'industry_includes', 'IT|情報通信|ソフトウェア', 5, 5, false)
  ) as v(axis, label, match_kind, match_value, points, sort_order, is_active)
where t.is_demo = false
  and not exists (select 1 from public.lead_scoring_rules r where r.tenant_id = t.id);

-- ---- 2) rescore_leads をルール駆動に差し替え(署名・呼出互換) ----
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
      else false end
  ),
  per_axis as (
    select h.lead_id, h.tenant_id, h.axis,
      least(a.cap, case when a.agg = 'sum' then sum(h.points) else max(h.points) end)::int as pts
    from hits h
    join lead_scoring_axes a on a.tenant_id = h.tenant_id and a.axis = h.axis
    group by h.lead_id, h.tenant_id, h.axis, a.cap, a.agg
  ),
  caps as ( -- 正規化母数: 有効ルールを1つ以上持つ軸のcap合計(テナント別)
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

-- ---- 3) 開封/クリック集計の精度改善(送信後60秒以内=スキャナ/先読みとみなし除外) ----
create or replace function public.lead_mail_batch_stats()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with b as (
    select * from lead_mail_batches where tenant_id in (select current_tenant_ids())
    order by created_at desc limit 100
  ),
  m as (
    select m.mail_batch_id, m.id, m.smtp_message_id, m.sent_at
    from email_messages m
    where m.mail_batch_id in (select id from b) and m.status = 'sent'
  ),
  ev as ( -- 人間の反応のみ(送信後60秒以内のイベントはボット/先読みとして除外)
    select e.email_message_id,
      bool_or(e.kind = 'open') as opened, bool_or(e.kind = 'click') as clicked
    from email_events e join m on m.id = e.email_message_id
    where e.occurred_at > m.sent_at + interval '60 seconds'
    group by e.email_message_id
  ),
  r as (
    select distinct m.id
    from m join email_messages rin
      on rin.direction = 'in' and rin.in_reply_to = m.smtp_message_id
    where m.smtp_message_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'title', b.title, 'createdAt', b.created_at,
    'templateId', b.template_id, 'filters', b.filters, 'sentBy', b.sent_by,
    'sent', b.sent_count, 'failed', b.failed_count,
    'opened', coalesce(s.opened, 0), 'clicked', coalesce(s.clicked, 0), 'replied', coalesce(s.replied, 0)
  ) order by b.created_at desc), '[]'::jsonb)
  from b
  left join (
    select m.mail_batch_id,
      count(*) filter (where ev.opened) as opened,
      count(*) filter (where ev.clicked) as clicked,
      count(*) filter (where m.id in (select id from r)) as replied
    from m left join ev on ev.email_message_id = m.id
    group by m.mail_batch_id
  ) s on s.mail_batch_id = b.id
$$;
revoke execute on function public.lead_mail_batch_stats() from public, anon;
grant execute on function public.lead_mail_batch_stats() to authenticated;

create or replace function public.lead_event_mail_stats()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with l as (
    select id, coalesce(nullif(raw_event, ''), '(流入なし)') as ev,
      (email is not null and email <> '') as has_email,
      (disposition is not null and disposition not in ('untouched')) as touched,
      (disposition = 'appointment') as appt,
      (account_id is not null or status = 'converted') as converted
    from leads where tenant_id in (select current_tenant_ids())
  ),
  m as (
    select m.lead_id, m.id, m.smtp_message_id, m.sent_at
    from email_messages m
    where m.tenant_id in (select current_tenant_ids()) and m.lead_id is not null and m.status = 'sent'
  ),
  ev as (
    select e.email_message_id,
      bool_or(e.kind = 'open') as opened, bool_or(e.kind = 'click') as clicked
    from email_events e join m on m.id = e.email_message_id
    where e.occurred_at > m.sent_at + interval '60 seconds'
    group by e.email_message_id
  ),
  r as (
    select distinct m.id
    from m join email_messages rin
      on rin.direction = 'in' and rin.in_reply_to = m.smtp_message_id
    where m.smtp_message_id is not null
  ),
  ml as (
    select m.lead_id,
      bool_or(true) as mailed, bool_or(coalesce(ev.opened, false)) as opened, bool_or(coalesce(ev.clicked, false)) as clicked,
      bool_or(m.id in (select id from r)) as replied
    from m left join ev on ev.email_message_id = m.id
    group by m.lead_id
  )
  select coalesce(jsonb_agg(row order by (row->>'mailed')::int desc, (row->>'leads')::int desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'event', l.ev,
      'leads', count(*),
      'withEmail', count(*) filter (where l.has_email),
      'mailed', count(*) filter (where ml.mailed),
      'opened', count(*) filter (where ml.opened),
      'clicked', count(*) filter (where ml.clicked),
      'replied', count(*) filter (where ml.replied),
      'touched', count(*) filter (where l.touched),
      'appointments', count(*) filter (where l.appt),
      'converted', count(*) filter (where l.converted)
    ) as row
    from l left join ml on ml.lead_id = l.id
    group by l.ev
  ) rows
$$;
revoke execute on function public.lead_event_mail_stats() from public, anon;
grant execute on function public.lead_event_mail_stats() to authenticated;
