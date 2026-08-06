-- =====================================================================
-- 顧客分析マトリクス: 取引ステージ(リードのみ / 商談済 / 成約済)を判定して返す
--
-- 目的:
--   マトリクスのセルに並ぶ顧客名を、一覧の時点で
--     ・リードのみ (lead)    = まだ商談していない。リード獲得・アポ設定止まり
--     ・商談済     (engaged) = 商談を実施したことがあるが受注はまだ
--     ・成約済     (won)     = 受注した案件がある
--   の3段階で色・アイコン分けできるようにする。
--
-- 判定を「案件の有無」でやらない理由:
--   本番データでは 784社中 783社が案件を1件以上持っている(案件レコードが
--   リード獲得の時点で作られる運用のため)。案件の有無で切ると「リードのみ」が
--   1社になり、区別として機能しない。
--   そこで「商談を実施した痕跡」で切る:
--     ・ステージが meeting_done(初回商談完了)以降まで進んだ案件がある
--       ※ステージ定義は src/lib/constants.ts の STAGES と対応
--     ・または first_meeting_date(初回商談日)が過去日の案件がある
--       ※失注(stage='lost')・保留は進捗が stage から消えるので、この日付で拾う
--     ・または activities に meeting(商談)の記録がある
--   実データでの分布: リードのみ 85社 / 商談済 641社 / 成約済 58社。
--
--   成約済の判定に受注【金額】(won > 0)を使わないのは、amount が 0 の受注案件
--   (CSV取込時の `?? 0` フォールバックで実際に発生する)を取りこぼすため。件数で見る。
--
-- 0205_account_matrix_filters.sql の3関数に、取引ステージの項目を足したもの。
-- 絞り込み(p_filter)の挙動は 0205 から変えていない。
--   account_matrix_base(jsonb)            … deal_stage / won_count / met_count / lead_count を追加
--                                           (返り値の型が変わるので drop → create)
--   account_segment_matrix(int, jsonb)    … accounts[] と matches[] に上記を追加。
--                                           cells[] にステージ別の社数を追加
--   account_segment_rank_accounts(...)    … accounts[] に上記を追加
--
-- ロールバック:
--   0205_account_matrix_filters.sql の3関数定義をそのまま再適用する。
-- =====================================================================

-- 返り値の列が増えるため create or replace では置き換えられない。
-- 呼び出し側(account_segment_matrix / account_segment_rank_accounts)は plpgsql 本文からの
-- 実行時解決なので、先に drop しても依存エラーにはならない(直後に作り直す)。
drop function if exists public.account_matrix_base(jsonb);

create or replace function public.account_matrix_base(p_filter jsonb default '{}'::jsonb)
returns table (
  id uuid, name text, industry text, area text, status text, owner_name text,
  segment_id uuid, segment_manual boolean,
  rank text, rank_auto boolean,
  won numeric, open_amt numeric, opp_count bigint, open_count bigint,
  employees int, last_won_date date,
  -- 取引ステージ: 'won'(成約済) / 'engaged'(商談済) / 'lead'(リードのみ)
  deal_stage text,
  won_count bigint, met_count bigint, lead_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  q text := nullif(btrim(coalesce(f->>'q', '')), '');
  qn text := nullif(public.company_search_key(nullif(btrim(coalesce(f->>'q', '')), '')), '');
  f_owner  text[] := to_text_array(f->'owner');
  f_area   text[] := to_text_array(f->'area');
  f_status text[] := to_text_array(f->'status');
  emp_min int := nullif(regexp_replace(coalesce(f->>'empMin', ''), '[^0-9]', '', 'g'), '')::int;
  emp_max int := nullif(regexp_replace(coalesce(f->>'empMax', ''), '[^0-9]', '', 'g'), '')::int;
  -- coalesce 必須: キーが無いと NULL になり、後続の `not won_none` などが NULL 判定で全行落ちる
  emp_unknown boolean := coalesce((f->>'empUnknown') = 'true', false);
  won_min numeric := nullif(regexp_replace(coalesce(f->>'wonMin', ''), '[^0-9]', '', 'g'), '')::numeric;
  won_max numeric := nullif(regexp_replace(coalesce(f->>'wonMax', ''), '[^0-9]', '', 'g'), '')::numeric;
  open_state text := nullif(f->>'openState', '');
  won_from date := case when f->>'wonFrom' ~ '^\d{4}-\d{2}-\d{2}$' then (f->>'wonFrom')::date end;
  won_to   date := case when f->>'wonTo'   ~ '^\d{4}-\d{2}-\d{2}$' then (f->>'wonTo')::date end;
  last_won_before date := case when f->>'lastWonBefore' ~ '^\d{4}-\d{2}-\d{2}$' then (f->>'lastWonBefore')::date end;
  won_none boolean := coalesce((f->>'wonNone') = 'true', false);
begin
  if v is null or array_length(v, 1) is null then
    return;
  end if;

  return query
  with cfg as materialized (
    -- 行が無いテナントでも既定値で動く
    select
      coalesce(max(s.s_revenue),   100000000::numeric) as s_revenue,
      coalesce(max(s.a_revenue),    10000000::numeric) as a_revenue,
      coalesce(max(s.a_potential), 100000000::numeric) as a_potential,
      coalesce(max(s.b_potential),  10000000::numeric) as b_potential,
      coalesce(max(s.s_employees), 1000) as s_employees,
      coalesce(max(s.a_employees),  100) as a_employees
    from public.account_rank_settings s
    where s.tenant_id = any(v)
  ),
  seg as materialized (
    select s.id, s.name, s.keywords, s.sort_order
    from public.account_segments s
    where s.tenant_id = any(v)
  ),
  -- 顧客そのものの属性で絞れるものは、ここで先に落とす(後段の JOIN 量を減らすため)
  acc as materialized (
    select a.id, a.name, a.rank as manual_rank, a.segment_id, a.industry,
           a.owner_user_id, a.status, a.area,
           public.account_employee_count(a.employee_size) as emp
    from public.accounts a
    where a.tenant_id = any(v)
      and a.deleted_at is null
      and (q is null
           or a.name ilike '%' || q || '%'
           or (qn is not null and a.search_key like '%' || qn || '%'))
      and (f_owner is null
           or a.owner_user_id::text = any(f_owner)
           or ('__none' = any(f_owner) and a.owner_user_id is null))
      and (f_area is null or a.area = any(f_area))
      and (f_status is null or a.status = any(f_status))
  ),
  opp as materialized (
    select o.account_id,
           coalesce(sum(o.amount) filter (where o.status = 'won'), 0)  as won,
           coalesce(sum(o.amount) filter (where o.status = 'open'), 0) as open_amt,
           count(*) as opp_count,
           count(*) filter (where o.status = 'open') as open_count,
           -- 成約済は金額ではなく件数で見る(amount = 0 の受注を取りこぼさないため)
           count(*) filter (where o.status = 'won') as won_count,
           -- 商談を実施した痕跡: ステージが初回商談完了以降 / 初回商談日が過去
           count(*) filter (
             where o.stage in (
                     'meeting_done', 'needs_confirmed', 'proposal_preparing',
                     'proposal_sent', 'internal_review', 'verbal_commit', 'won'
                   )
                or (o.first_meeting_date is not null and o.first_meeting_date <= current_date)
           ) as met_count,
           max(o.expected_close_date) filter (where o.status = 'won') as last_won,
           -- 受注時期の絞り込み用。期間指定が無いときは常に0で、後段の条件も無効になる
           count(*) filter (
             where o.status = 'won'
               and (won_from is not null or won_to is not null)
               and o.expected_close_date is not null
               and (won_from is null or o.expected_close_date >= won_from)
               and (won_to is null or o.expected_close_date <= won_to)
           ) as won_in_period
    from public.opportunities o
    where o.tenant_id = any(v)
      and o.account_id is not null
      and o.deleted_at is null
    group by o.account_id
  ),
  -- 案件に紐づかない商談(単発の訪問など)も「商談済」として拾う
  met_act as materialized (
    select x.account_id, count(*) as n
    from public.activities x
    where x.tenant_id = any(v)
      and x.account_id is not null
      and x.activity_type = 'meeting'
    group by x.account_id
  ),
  -- リード件数。ステージ判定には使わず、ツールチップの表示用
  led as materialized (
    select l.account_id, count(*) as lead_count
    from public.leads l
    where l.tenant_id = any(v)
      and l.account_id is not null
    group by l.account_id
  ),
  -- セグメント解決: 手動(accounts.segment_id) → industry のキーワード部分一致(sort_order順の先頭)
  resolved as materialized (
    select a.id, a.name, a.industry, a.owner_user_id, a.status, a.area, a.emp,
           coalesce(a.segment_id, k.seg_id) as segment_id,
           (a.segment_id is not null) as segment_manual,
           coalesce(o.won, 0) as won,
           coalesce(o.open_amt, 0) as open_amt,
           coalesce(o.opp_count, 0) as opp_count,
           coalesce(o.open_count, 0) as open_count,
           o.last_won,
           coalesce(o.won_in_period, 0) as won_in_period,
           coalesce(o.won_count, 0) as won_count,
           coalesce(o.met_count, 0) + coalesce(ma.n, 0) as met_count,
           coalesce(g.lead_count, 0) as lead_count,
           a.manual_rank
    from acc a
    left join opp o on o.account_id = a.id
    left join met_act ma on ma.account_id = a.id
    left join led g on g.account_id = a.id
    left join lateral (
      select s.id as seg_id
      from seg s
      where a.segment_id is null
        and a.industry is not null
        and btrim(a.industry) <> ''
        and exists (
          select 1 from unnest(s.keywords) as k(w)
          where btrim(k.w) <> '' and a.industry ilike '%' || btrim(k.w) || '%'
        )
      order by s.sort_order, s.name
      limit 1
    ) k on true
  )
  select r.id, r.name, r.industry, r.area, r.status,
         coalesce(p.display_name, p.email) as owner_name,
         r.segment_id, r.segment_manual,
         case
           -- 手動ランクが最優先。旧データの 'dormant' は D 相当に寄せる
           when r.manual_rank in ('S', 'A', 'B', 'C', 'D') then r.manual_rank
           when r.manual_rank = 'dormant' then 'D'
           when r.emp >= c.s_employees or r.won >= c.s_revenue then 'S'
           when r.emp >= c.a_employees or r.won >= c.a_revenue or r.open_amt >= c.a_potential then 'A'
           when r.won > 0 or r.open_amt >= c.b_potential then 'B'
           when r.opp_count > 0 then 'C'
           else 'D'
         end as rank,
         (r.manual_rank is null or r.manual_rank not in ('S', 'A', 'B', 'C', 'D', 'dormant')) as rank_auto,
         r.won, r.open_amt, r.opp_count, r.open_count,
         r.emp, r.last_won,
         case
           when r.won_count > 0 then 'won'
           when r.met_count > 0 then 'engaged'
           else 'lead'
         end as deal_stage,
         r.won_count, r.met_count, r.lead_count
  from resolved r
  cross join cfg c
  left join public.profiles p on p.id = r.owner_user_id
  -- 案件の集計と従業員数の抽出が要る条件は、計算済みのここで掛ける
  where (case
           when emp_unknown then r.emp is null
           when emp_min is not null or emp_max is not null then
             r.emp is not null
             and (emp_min is null or r.emp >= emp_min)
             and (emp_max is null or r.emp <= emp_max)
           else true
         end)
    and (won_min is null or r.won >= won_min)
    and (won_max is null or r.won <= won_max)
    and (open_state is null
         or (open_state = 'open' and r.open_count > 0)
         or (open_state = 'none' and r.open_count = 0))
    and ((won_from is null and won_to is null) or r.won_in_period > 0)
    and (last_won_before is null or (r.last_won is not null and r.last_won < last_won_before))
    and (not won_none or r.won <= 0);
end $$;

revoke execute on function public.account_matrix_base(jsonb) from public, anon;
grant execute on function public.account_matrix_base(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- マトリクス本体
--   返り値: { settings, segments[], cells[], matches[] }
--   cells[].accounts は各セルにつき p_max_per_cell 件まで(累計受注の降順)。
--   matches は会社名検索(q)をしたときだけ入る「その会社が居るセル」の一覧。
-- ---------------------------------------------------------------------
create or replace function public.account_segment_matrix(
  p_max_per_cell int default 8,
  p_filter jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  v_limit int := least(greatest(coalesce(p_max_per_cell, 8), 1), 100);
  -- 検索語がある時だけ「どのセルに居るか」を返す
  has_q boolean := nullif(btrim(coalesce(p_filter->>'q', '')), '') is not null;
  result jsonb;
begin
  if v is null or array_length(v, 1) is null then
    return jsonb_build_object('segments', '[]'::jsonb, 'cells', '[]'::jsonb, 'settings', '{}'::jsonb, 'matches', '[]'::jsonb);
  end if;

  with base as materialized (
    select * from public.account_matrix_base(coalesce(p_filter, '{}'::jsonb))
  ),
  numbered as materialized (
    select b.*,
           row_number() over (
             partition by coalesce(b.segment_id::text, '__none__'), b.rank
             order by b.won desc, b.open_amt desc, b.name
           ) as rn,
           -- 検索ヒット一覧(matches)の打ち切り用。セルをまたいだ通し番号
           row_number() over (order by b.won desc, b.name) as hit_rn
    from base b
  ),
  cells as (
    select coalesce(n.segment_id::text, '__none__') as segment_key,
           n.rank,
           count(*) as cnt,
           sum(n.won) as won,
           sum(n.open_amt) as open_amt,
           -- セルは上位 p_max_per_cell 件しか顧客名を返さないので、内訳はセル単位で別に持つ
           count(*) filter (where n.deal_stage = 'won') as won_accounts,
           count(*) filter (where n.deal_stage = 'engaged') as engaged_accounts,
           count(*) filter (where n.deal_stage = 'lead') as lead_accounts,
           coalesce(jsonb_agg(
             jsonb_build_object(
               'id', n.id, 'name', n.name, 'industry', n.industry, 'area', n.area,
               'status', n.status, 'ownerName', n.owner_name,
               'won', n.won, 'openAmount', n.open_amt,
               'oppCount', n.opp_count, 'openCount', n.open_count,
               'employees', n.employees, 'lastWonDate', n.last_won_date,
               'dealStage', n.deal_stage,
               'wonCount', n.won_count, 'metCount', n.met_count, 'leadCount', n.lead_count,
               'rankAuto', n.rank_auto, 'segmentManual', n.segment_manual
             ) order by n.won desc, n.open_amt desc, n.name
           ) filter (where n.rn <= v_limit), '[]'::jsonb) as accounts
    from numbered n
    group by 1, 2
  )
  select jsonb_build_object(
    'settings', (
      select to_jsonb(x) from (
        select
          coalesce(max(s.s_revenue),   100000000::numeric) as s_revenue,
          coalesce(max(s.a_revenue),    10000000::numeric) as a_revenue,
          coalesce(max(s.a_potential), 100000000::numeric) as a_potential,
          coalesce(max(s.b_potential),  10000000::numeric) as b_potential,
          coalesce(max(s.s_employees), 1000) as s_employees,
          coalesce(max(s.a_employees),  100) as a_employees
        from public.account_rank_settings s where s.tenant_id = any(v)
      ) x
    ),
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'color', s.color,
               'keywords', to_jsonb(s.keywords),
               'sortOrder', s.sort_order, 'isVisible', s.is_visible
             ) order by s.sort_order, s.name)
      from public.account_segments s where s.tenant_id = any(v)
    ), '[]'::jsonb),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
               'segmentKey', c.segment_key, 'rank', c.rank, 'count', c.cnt,
               'won', c.won, 'openAmount', c.open_amt,
               'wonAccounts', c.won_accounts,
               'engagedAccounts', c.engaged_accounts,
               'leadAccounts', c.lead_accounts,
               'accounts', c.accounts
             ))
      from cells c
    ), '[]'::jsonb),
    'matches', case when not has_q then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'name', n.name,
               'segmentKey', coalesce(n.segment_id::text, '__none__'),
               'rank', n.rank, 'won', n.won, 'dealStage', n.deal_stage
             ) order by n.won desc, n.name)
      from numbered n
      -- 一覧で並べるので上限を切る(超過分はマトリクス本体で見る)
      where n.hit_rn <= 30
    ), '[]'::jsonb) end
  ) into result;

  return result;
end $$;

revoke execute on function public.account_segment_matrix(int, jsonb) from public, anon;
grant execute on function public.account_segment_matrix(int, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- セル明細(「他N社」を開いたときの続き)
--   p_segment に '__none__' を渡すと未分類セル。
--   p_filter はマトリクス本体と同じものを渡す(件数がずれないように)。
-- ---------------------------------------------------------------------
create or replace function public.account_segment_rank_accounts(
  p_segment text,
  p_rank text,
  p_offset int default 0,
  p_limit int default 50,
  p_filter jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  with base as materialized (
    select b.* from public.account_matrix_base(coalesce(p_filter, '{}'::jsonb)) b
    where b.rank = p_rank
      and coalesce(b.segment_id::text, '__none__') = coalesce(nullif(p_segment, ''), '__none__')
  ),
  ordered as materialized (
    select b.*, row_number() over (order by b.won desc, b.open_amt desc, b.name) as rn,
           count(*) over () as total
    from base b
  )
  select jsonb_build_object(
    'total', coalesce((select max(o.total) from ordered o), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'name', o.name, 'industry', o.industry, 'area', o.area,
               'status', o.status, 'ownerName', o.owner_name,
               'won', o.won, 'openAmount', o.open_amt,
               'oppCount', o.opp_count, 'openCount', o.open_count,
               'employees', o.employees, 'lastWonDate', o.last_won_date,
               'dealStage', o.deal_stage,
               'wonCount', o.won_count, 'metCount', o.met_count, 'leadCount', o.lead_count,
               'rankAuto', o.rank_auto, 'segmentManual', o.segment_manual
             ) order by o.rn)
      from ordered o
      where o.rn > v_offset and o.rn <= v_offset + v_limit
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.account_segment_rank_accounts(text, text, int, int, jsonb) from public, anon;
grant execute on function public.account_segment_rank_accounts(text, text, int, int, jsonb) to authenticated;
