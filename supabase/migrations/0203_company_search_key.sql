-- =====================================================================
-- 0203: 会社名の表記ゆれを吸収する検索
--   「株式会社カトルセ」「カトルセ株式会社」「㈱カトルセ」「ｶﾄﾙｾ」「かとるせ」
--   「CATORCE Co., Ltd.」を同一視し、法人格の有無に関わらず検索が当たるようにする。
--   検索語を正規化したキーが、データを正規化したキーに部分一致すれば HIT。
--   → 「株式会社カトルセ」で検索し、データが「カトルセ」だけでもヒットする。
--
--   対象RPC: accounts_page(顧客) / opportunities_page(案件) /
--            activities_page(商談・活動) / global_search(ヘッダー横断検索)
--   いずれも「従来の生の ilike」との OR で足しているだけなので、
--   これまでヒットしていたものが落ちることはない。
--
--   TS 側の同一実装は src/lib/company-name.ts の companySearchKey()。
--   規則を変えるときは必ず両方を揃える(tests/company-name.test.ts で担保)。
--
--   既存の norm_company() / norm_company_name() は、leads.company_norm 列や
--   business_cards の式インデックスの値を決めているため触らない(別関数として追加)。
-- =====================================================================

-- ---- 正規化: 表記ゆれを畳んだ検索キー ----
-- NFKC → 小文字化 → 法人格除去(日/英) → 空白除去 → 記号除去 → ひらがな→カタカナ。
-- 畳んだ結果が空(例: 「株式会社」だけ)なら null を返す(全件ヒットの防止に使う)。
create or replace function public.company_search_key(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    -- 6) ひらがな(U+3041〜U+3096) → カタカナ(U+30A1〜U+30F6)
    translate(
      -- 5) 記号を除去(NFKC 済みなので全角記号は ASCII に畳まれている)
      translate(
        -- 4) 空白を除去
        regexp_replace(
          -- 3) 法人格(英語)を除去。前後が英数字のときは削らない("Incheon" の "Inc" 対策)
          regexp_replace(
            -- 2) 法人格(日本語)を除去。長いものを先に並べる
            regexp_replace(
              -- 1) NFKC 正規化 + 小文字化
              --    半角カナ→全角カナ、全角英数→半角、㈱→(株)、全角空白→半角空白
              lower(normalize(coalesce(t, ''), NFKC)),
              '(株式会社|有限会社|合同会社|合資会社|合名会社|相互会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|社会福祉法人|医療法人社団|医療法人財団|医療法人|学校法人|宗教法人|独立行政法人|国立大学法人|公立大学法人|弁護士法人|税理士法人|司法書士法人|行政書士法人|社会保険労務士法人|監査法人|事業協同組合|農業協同組合|生活協同組合|企業組合|協同組合|\(株\)|\(有\)|\(合\)|\(名\)|\(資\)|\(社\)|\(財\)|㈱|㈲|㈳|㈶)',
              '', 'g'),
            '(?<![0-9a-z])(co\.?[[:space:]]*,?[[:space:]]*ltd|corporation|incorporated|company|limited|inc|corp|ltd|llc|llp|plc|gmbh|pty|k\.?k)\.?(?![0-9a-z])',
            '', 'g'),
          '[[:space:]]', '', 'g'),
        '!"#$%&''()*+,-./:;<=>?@[\]^_`{|}~、。，．・：；？！゛゜〆ー―‐～〜｜…‘’“”〔〕〈〉《》「」『』【】', ''),
      'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
      'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ'),
  '')
$$;

comment on function public.company_search_key(text) is
  '会社名の表記ゆれ(法人格・全半角・かな・記号・空白)を畳んだ検索キー。src/lib/company-name.ts の companySearchKey() と同一規則。';


-- ---- 正規化キーを生成列として保持する ----
-- company_search_key() は1行あたり約30µs かかる。leads(12,000行)を毎回走査すると
-- global_search が 480ms(予算500ms)まで悪化したため、書き込み時に計算して保持する。
-- 実測: leads の走査 405ms → 73ms、global_search 480ms → 72ms。
--
-- ⚠ 生成列は company_search_key の定義を変えても再計算されない。
--   規則を変更するときは列を drop / add し直して作り直すこと(式インデックスと同じ注意)。
alter table public.accounts      add column if not exists search_key text generated always as (public.company_search_key(name)) stored;
alter table public.opportunities add column if not exists search_key text generated always as (public.company_search_key(name)) stored;
alter table public.leads         add column if not exists search_key text generated always as (public.company_search_key(company_name)) stored;

comment on column public.accounts.search_key is
  '会社名の表記ゆれを畳んだ検索キー(company_search_key の生成列)。company_search_key を変更したら列を作り直して再計算すること。';
comment on column public.opportunities.search_key is
  '案件名の表記ゆれを畳んだ検索キー(company_search_key の生成列)。';
comment on column public.leads.search_key is
  '会社名の表記ゆれを畳んだ検索キー(company_search_key の生成列)。';

-- リード一覧はビュー lead_list_eng(0192) 越しに引くため、search_key を通す。
-- l.* の展開位置が変わり create or replace view では列順が合わないので作り直す
-- (2026-08 時点でこのビューに依存する他オブジェクトは無いことを pg_depend で確認済)。
drop view if exists public.lead_list_eng;
create view public.lead_list_eng
with (security_invoker = true) as
select
  l.*,
  pe.rank          as eng_rank,
  pe.score         as eng_score,
  pe.touch_count   as eng_touch_count,
  pe.last_touch_at as eng_last_touch_at
from public.leads l
left join public.person_engagement pe
  on pe.tenant_id = l.tenant_id
 and pe.email = lower(l.email);

comment on view public.lead_list_eng is 'リード一覧+エンゲージメント(person_engagement をメール小文字で突合)。eng_rank が null のリードは接点なし(=Dランク相当)。';

grant select on public.lead_list_eng to authenticated, service_role;


-- ---- accounts_page (0193ベース + 会社名の表記ゆれ吸収) ----
create or replace function public.accounts_page(
  p_filter jsonb default '{}'::jsonb,
  p_sort text default 'revenue'::text,
  p_asc boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  -- 表記ゆれを畳んだ検索キー。法人格だけの入力等でキーが空になったら null(=正規化検索は使わない)
  qn text := company_search_key(q);
  -- 各絞り込みを text[] に正規化(配列/スカラー両対応)。null は絞り込みなし。
  f_rank text[] := to_text_array(p_filter->'rank');
  f_focus text[] := to_text_array(p_filter->'focus');
  f_area text[] := to_text_array(p_filter->'area');
  f_industry text[] := to_text_array(p_filter->'industry');
  f_owner text[] := to_text_array(p_filter->'owner');
  f_active text := nullif(p_filter->>'active', '');
  f_eng_rank text[] := to_text_array(p_filter->'engRank');
  f_eng_min int := nullif(regexp_replace(coalesce(p_filter->>'engMin',''), '[^0-9]', '', 'g'), '')::int;
  sort_expr text := case p_sort
    when 'openAmount' then 'open_amount'
    when 'oppCount' then 'opp_count'
    when 'name' then 'name'
    when 'rank' then 'rank_order'
    when 'engagement' then 'engagement_score'
    else 'lifetime_revenue' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with agg as (
      select a.id, a.name, a.industry, a.area, a.status, a.rank, a.focus, a.owner_user_id,
        a.engagement_score, a.engagement_rank,
        coalesce(p.display_name, p.email, '—') as owner_name,
        coalesce(sum(o.amount) filter (where o.status = 'won'), 0) as lifetime_revenue,
        coalesce(sum(o.amount) filter (where o.status = 'open'), 0) as open_amount,
        count(o.id) as opp_count,
        (count(o.id) filter (where o.status = 'open')) > 0 as is_active,
        case a.rank when 'S' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'dormant' then 4 else 9 end as rank_order
      from accounts a
        left join opportunities o on o.account_id = a.id and o.deleted_at is null
        left join profiles p on p.id = a.owner_user_id
      where a.tenant_id = any($1)
        and a.deleted_at is null
        and ($2 is null or a.name ilike '%%' || $2 || '%%'
             or ($13 is not null and a.search_key like '%%' || $13 || '%%'))
        and ($3 is null or a.rank = any($3))
        and ($4 is null or a.focus = any($4))
        and ($5 is null or a.area = any($5))
        and ($6 is null or a.industry = any($6))
        and ($7 is null or a.owner_user_id::text = any($7) or ('__none' = any($7) and a.owner_user_id is null))
        and ($11 is null or a.engagement_rank = any($11) or ('D' = any($11) and a.engagement_rank is null))
        and ($12 is null or coalesce(a.engagement_score, 0) >= $12)
      group by a.id, p.display_name, p.email
    ),
    filt as (
      select *, count(*) over() as total, row_number() over(order by %s %s nulls last, name asc) as rn
      from agg
      where ($8 is null or ($8 = 'active' and is_active) or ($8 = 'inactive' and not is_active))
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(to_jsonb(filt) - 'total' - 'rn' - 'rank_order' order by rn) filter (where rn > $9 and rn <= $9 + $10), '[]'::jsonb),
      'total', coalesce(max(total), 0)
    ) from filt
  $f$, sort_expr, dir)
  into result
  using v, q, f_rank, f_focus, f_area, f_industry, f_owner, f_active, p_offset, p_limit, f_eng_rank, f_eng_min, qn;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0));
end $function$;

revoke execute on function public.accounts_page(jsonb, text, boolean, int, int) from public, anon;
grant execute on function public.accounts_page(jsonb, text, boolean, int, int) to authenticated;


-- ---- opportunities_page (0170ベース + 会社名の表記ゆれ吸収) ----
-- 案件名・顧客名のどちらも正規化キーで照合する。
create or replace function public.opportunities_page(
  p_filter jsonb default '{}'::jsonb,
  p_sort text default 'expected_close_date'::text,
  p_asc boolean default true,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := nullif(p_filter->>'q', '');
  qn text := company_search_key(q);
  yomi text[] := case when jsonb_typeof(p_filter->'yomi') = 'array' and jsonb_array_length(p_filter->'yomi') > 0
                      then array(select jsonb_array_elements_text(p_filter->'yomi')) else null end;
  f_owner uuid := nullif(p_filter->>'owner', '')::uuid;
  f_product uuid := nullif(p_filter->>'product', '')::uuid;
  f_source uuid := nullif(p_filter->>'source', '')::uuid;
  f_sd text := nullif(p_filter->>'campaign', '');
  only_no_next boolean := coalesce((p_filter->>'only_no_next')::boolean, false);
  only_stale boolean := coalesce((p_filter->>'only_stale')::boolean, false);
  sort_col text := case p_sort
    when 'name' then 'a.name'
    when 'yomi' then 'o.yomi'
    when 'owner' then 'p.display_name'
    when 'product' then 'pr.name'
    when 'source_detail' then 'o.source_detail'
    when 'stage' then 'o.stage'
    when 'amount' then 'o.amount'
    when 'probability' then 'o.probability'
    when 'next_action_date' then 'coalesce(na.due, o.next_action_date)'
    when 'last_activity_at' then 'o.last_activity_at'
    when 'meeting_count' then '(select count(*) from meetings mt where mt.opportunity_id = o.id)'
    when 'last_meeting_date' then '(select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id)'
    else 'o.expected_close_date' end;
  dir text := case when p_asc then 'asc' else 'desc' end;
  result jsonb;
begin
  execute format($f$
    with f as (
      select o.id, o.name, a.name as account_name, o.yomi, o.owner_user_id,
        coalesce(p.display_name, p.email, '—') as owner_name, p.avatar_color as owner_color,
        o.primary_product_id, pr.name as product_name, o.campaign_id, c.name as campaign_name, o.campaign_estimated,
        o.lead_source_id, ls.name as source_name, o.source_detail,
        o.amount, o.stage, o.probability, o.forecast_category, o.status, o.deal_phase,
        o.expected_close_date, o.expected_revenue_month,
        coalesce(na.due, o.next_action_date) as next_action_date,
        coalesce(na.title, o.next_action_text) as next_action_text,
        o.notes, o.last_activity_at,
        o.risk_level, o.first_meeting_date, o.appointment_at, o.created_at, o.updated_at,
        (select count(*) from meetings mt where mt.opportunity_id = o.id)::int as meeting_count,
        (select max(coalesce(mt.meeting_at::date, mt.meeting_date)) from meetings mt where mt.opportunity_id = o.id) as last_meeting_date,
        case
          when na.due is not null then 'open'
          when exists(select 1 from tasks t where t.opportunity_id = o.id and t.origin = 'next_action' and t.status = 'done') then 'done'
          else null
        end as next_action_status,
        coalesce(
          na.id,
          (select t.id from tasks t where t.opportunity_id = o.id and t.origin = 'next_action'
             order by (t.status = 'done') asc, t.created_at desc limit 1)
        ) as next_action_task_id,
        round(o.amount * o.probability / 100.0) as weighted,
        count(*) over() as total,
        sum(o.amount) over() as sum_amount,
        sum(round(o.amount * o.probability / 100.0)) over() as sum_weighted,
        row_number() over(order by %s %s nulls last) as rn
      from opportunities o
        left join accounts a on a.id = o.account_id
        left join profiles p on p.id = o.owner_user_id
        left join products pr on pr.id = o.primary_product_id
        left join campaigns c on c.id = o.campaign_id
        left join lead_sources ls on ls.id = o.lead_source_id
        left join lateral (
          select t.id, t.due_date as due, t.title
          from tasks t
          where t.opportunity_id = o.id and t.origin = 'next_action' and t.status <> 'done'
          order by t.due_date asc nulls last, t.created_at desc
          limit 1
        ) na on true
      where o.tenant_id = any($1)
        and o.deleted_at is null
        and (can_view_sales_numbers(o.tenant_id) or o.owner_user_id = auth.uid())
        and ($2 is null or o.name ilike '%%' || $2 || '%%' or a.name ilike '%%' || $2 || '%%'
             or ($12 is not null and (o.search_key like '%%' || $12 || '%%'
                                      or a.search_key like '%%' || $12 || '%%')))
        and ($3 is null or o.yomi = any($3))
        and ($4 is null or o.owner_user_id = $4)
        and ($5 is null or o.primary_product_id = $5)
        and ($6 is null or o.lead_source_id = $6)
        and ($7 is null or btrim(o.source_detail) = $7)
        and (not $8 or (o.status = 'open' and na.due is null))
        and (not $9 or (o.status = 'open' and o.last_activity_at < now() - interval '7 day'))
      order by %s %s nulls last
      limit $10 offset $11
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(to_jsonb(f) - 'total' - 'sum_amount' - 'sum_weighted' - 'rn' order by f.rn), '[]'::jsonb),
      'total', coalesce(max(f.total), 0),
      'sum_amount', coalesce(max(f.sum_amount), 0),
      'sum_weighted', coalesce(max(f.sum_weighted), 0)
    ) from f
  $f$, sort_col, dir, sort_col, dir)
  into result
  using v, q, yomi, f_owner, f_product, f_source, f_sd, only_no_next, only_stale, p_limit, p_offset, qn;
  return coalesce(result, jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'sum_amount', 0, 'sum_weighted', 0));
end $function$;

revoke execute on function public.opportunities_page(jsonb, text, boolean, int, int) from public, anon;
grant execute on function public.opportunities_page(jsonb, text, boolean, int, int) to authenticated;


-- ---- activities_page (0065ベース + 会社名の表記ゆれ吸収) ----
-- 商談・活動の一覧。件名/案件名/顧客名を正規化キーでも照合する
-- (件名は「株式会社○○ 初回商談」のように会社名を含むことが多いため対象に入れる)。
-- 件名は生成列を持たないため関数呼び出しだが、activities は700行規模で影響は小さい。
create or replace function public.activities_page(
  p_filter jsonb default '{}'::jsonb,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with p as (
    select nullif(p_filter->>'q', '') as q,
           company_search_key(nullif(p_filter->>'q', '')) as qn
  ),
  f as (
    select act.id, act.activity_type, act.title, act.body, act.activity_at,
      act.owner_user_id, coalesce(pr.display_name, pr.email, '—') as owner_name, pr.avatar_color as owner_color,
      act.opportunity_id, o.name as opportunity_name,
      act.account_id, coalesce(a.name, oa.name) as account_name,
      count(*) over() as total
    from activities act
      cross join p
      left join profiles pr on pr.id = act.owner_user_id
      left join opportunities o on o.id = act.opportunity_id
      left join accounts a on a.id = act.account_id
      left join accounts oa on oa.id = o.account_id
    where act.tenant_id in (select current_tenant_ids())
      and (
        can_view_all(act.tenant_id)
        or act.owner_user_id = auth.uid()
        or (o.id is not null and o.owner_user_id = auth.uid())
      )
      -- ゴミ箱入りの案件/顧客に紐づく活動は出さない
      and (act.opportunity_id is null or o.deleted_at is null)
      and (act.account_id is null or a.deleted_at is null)
      and (nullif(p_filter->>'owner','') is null or act.owner_user_id = (p_filter->>'owner')::uuid)
      and (nullif(p_filter->>'type','') is null or act.activity_type = p_filter->>'type')
      and (p.q is null
           or act.title ilike '%' || p.q || '%'
           or act.body ilike '%' || p.q || '%'
           or o.name ilike '%' || p.q || '%'
           or coalesce(a.name, oa.name) ilike '%' || p.q || '%'
           or (p.qn is not null
               and (company_search_key(act.title) like '%' || p.qn || '%'
                    or o.search_key like '%' || p.qn || '%'
                    or coalesce(a.search_key, oa.search_key) like '%' || p.qn || '%')))
    order by act.activity_at desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(to_jsonb(f) - 'total' order by f.activity_at desc), '[]'::jsonb),
    'total', coalesce(max(f.total), 0)
  ) from f;
$$;

revoke execute on function public.activities_page(jsonb, int, int) from public, anon;
grant execute on function public.activities_page(jsonb, int, int) to authenticated;


-- ---- global_search (0063ベース + 会社名の表記ゆれ吸収) ----
create or replace function public.global_search(p_q text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v uuid[] := array(select current_tenant_ids());
  q text := trim(p_q);
  qn text;
  result jsonb;
begin
  if q = '' or q is null then
    return '[]'::jsonb;
  end if;
  qn := company_search_key(q);
  with acc as (
    select 'account' as kind, a.id::text, a.name as title,
      coalesce(a.industry,'') || case when a.rank is not null then ' ・ ランク' || a.rank else '' end as sub
    from accounts a
    where a.tenant_id = any(v) and a.deleted_at is null
      and (a.name ilike '%'||q||'%'
           or (qn is not null and a.search_key like '%'||qn||'%'))
    order by a.name limit 8
  ),
  opp as (
    select 'opportunity' as kind, o.id::text, coalesce(a.name,'') || '｜' || o.name as title,
      coalesce(o.yomi,'') || case when o.amount > 0 then ' ・ ' || to_char(o.amount, 'FM999,999,999') || '円' else '' end as sub
    from opportunities o left join accounts a on a.id = o.account_id
    where o.tenant_id = any(v) and o.deleted_at is null
      and (o.name ilike '%'||q||'%' or a.name ilike '%'||q||'%'
           or (qn is not null and (o.search_key like '%'||qn||'%' or a.search_key like '%'||qn||'%')))
    order by o.last_activity_at desc nulls last limit 8
  ),
  ld as (
    select 'lead' as kind, l.id::text, coalesce(l.company_name,'') || case when l.contact_name is not null then '｜' || l.contact_name else '' end as title,
      coalesce(l.raw_event,'') || case when l.rank is not null then ' ・ ' || l.rank else '' end as sub
    from leads l
    where l.tenant_id = any(v) and l.deleted_at is null
      and (l.company_name ilike '%'||q||'%' or l.contact_name ilike '%'||q||'%'
           or (qn is not null and l.search_key like '%'||qn||'%'))
    order by l.priority_score desc nulls last limit 8
  )
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into result
  from (select * from acc union all select * from opp union all select * from ld) x;
  return result;
end $function$;

revoke execute on function public.global_search(text) from public, anon;
grant execute on function public.global_search(text) to authenticated;


-- ---- workspace_lite / workspace_full から search_key を落とす ----
-- 生成列は検索専用でクライアントは読まないため、ペイロード削減済みのこの2本には載せない(0120の方針を踏襲)。
create or replace function public.workspace_lite()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (select id, email, display_name, avatar_color from profiles) p),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from memberships m),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a) - 'search_key'), '[]'::jsonb) from accounts a),
    'lead_sources', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from lead_sources s),
    'campaigns', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from campaigns c),
    'products', (select coalesce(jsonb_agg(to_jsonb(pr)), '[]'::jsonb) from products pr),
    'opportunities', (select coalesce(jsonb_agg(
        to_jsonb(o) - '{customer_issue,proposed_solution,hq_comment,hq_approval_status,meeting_doc_url,proposal_doc_url,competitor,budget_status,decision_maker_status,next_action_owner_id,reapproach_date,solution_package_id,win_reason,opportunity_type,external_ref,import_source,pre_research,sales_strategy,search_key}'::text[]
      ), '[]'::jsonb) from opportunities o),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tasks t),
    'sales_targets', (select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from sales_targets st),
    'rep_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb) from rep_targets rt)
  )
$function$;

create or replace function public.workspace_full()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (select id, email, display_name, avatar_color from profiles) p),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from memberships m),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a) - 'search_key'), '[]'::jsonb) from accounts a),
    'contacts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from contacts c),
    'lead_sources', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from lead_sources s),
    'campaigns', (select coalesce(jsonb_agg(to_jsonb(ca)), '[]'::jsonb) from campaigns ca),
    'products', (select coalesce(jsonb_agg(to_jsonb(pr)), '[]'::jsonb) from products pr),
    'opportunities', (select coalesce(jsonb_agg(
        to_jsonb(o) - '{pre_research,sales_strategy,search_key}'::text[]
      ), '[]'::jsonb) from opportunities o),
    'meetings', (select coalesce(jsonb_agg(to_jsonb(me)), '[]'::jsonb) from meetings me),
    'billing_schedules', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from billing_schedules b),
    'activities', (select coalesce(jsonb_agg(to_jsonb(ac)), '[]'::jsonb) from activities ac),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tasks t),
    'stage_histories', (select coalesce(jsonb_agg(to_jsonb(sh)), '[]'::jsonb) from stage_histories sh),
    'sales_targets', (select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from sales_targets st),
    'rep_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb) from rep_targets rt),
    'seminar_responses', (select coalesce(jsonb_agg(to_jsonb(sr)), '[]'::jsonb) from seminar_responses sr),
    'lead_import_batches', (select coalesce(jsonb_agg(to_jsonb(lib)), '[]'::jsonb) from lead_import_batches lib),
    'acquirer_aliases', (select coalesce(jsonb_agg(to_jsonb(aa)), '[]'::jsonb) from acquirer_aliases aa)
  )
$function$;
