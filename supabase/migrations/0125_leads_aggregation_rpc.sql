-- =====================================================================
-- 0125: リード集計のSQL化（監査指摘の最重要項目 / 8千行のアプリ転送を解消）
--   企業ビュー(buildCompanies)・ファネル(buildFunnel)・分析(buildAnalysis)の
--   JS集計を、行を転送しないSQL集計RPCへ移行する。
--   - 出力形状・ソート順・バケット判定はJS実装(leads-workspace.ts)と完全互換
--   - 可視範囲はRLS(leads_select)と同一: 管理系ロール=全件 / それ以外=自分担当のみ
--   - 時間帯分布(hourDist)は従来同様UTC時(JSがISO文字列のT hhを見ていた挙動を保存)
-- =====================================================================

-- ---- ファネル(アポ前ファネル: ステージ別件数+上位50件) ----
create or replace function public.leads_funnel()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with base as materialized (
    select l.id,
           coalesce(l.company_name, '') as cname,
           coalesce(l.contact_name, '') as nm,
           coalesce(l.rank, '') as rnk,
           coalesce(l.priority_score, 0) as score,
           coalesce(nullif(l.funnel_stage, ''), 'new') as fs
    from leads l
    where l.deleted_at is null
      and (l.tenant_id in (select view_all_tenant_ids())
        or (l.tenant_id in (select current_tenant_ids()) and l.owner_user_id = (select auth.uid())))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'stages', coalesce((
      select jsonb_object_agg(g.fs, jsonb_build_object(
        'key', g.fs,
        'count', g.cnt,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('id', x.id, 'company', x.cname, 'name', x.nm, 'rank', x.rnk, 'score', x.score)
                           order by x.score desc, x.id)
          from (select * from base b2 where b2.fs = g.fs order by b2.score desc, b2.id limit 50) x
        ), '[]'::jsonb)
      ))
      from (select fs, count(*) as cnt from base group by fs) g
    ), '{}'::jsonb)
  )
$$;
revoke execute on function public.leads_funnel() from public, anon;
grant execute on function public.leads_funnel() to authenticated;

-- ---- 企業ビュー(会社単位の名寄せ: 上位400社+総数+複数展示会接点数) ----
create or replace function public.leads_companies()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with base as materialized (
    select l.id,
           coalesce(nullif(l.company_norm, ''), l.company_name, '') as ck,
           coalesce(l.company_name, '') as cname,
           coalesce(l.raw_event, '') as ev,
           coalesce(l.priority_score, 0) as score,
           coalesce(l.disposition, 'untouched') as disp
    from leads l
    where l.deleted_at is null
      and (l.tenant_id in (select view_all_tenant_ids())
        or (l.tenant_id in (select current_tenant_ids()) and l.owner_user_id = (select auth.uid())))
  ),
  comp as (
    select ck,
      (array_agg(id order by id))[1] as first_id,
      (array_agg(cname order by id))[1] as name,
      count(*) as contacts,
      count(distinct ev) filter (where ev <> '') as events_n,
      max(score) as max_score,
      -- JSのDISP_ORDER優先(未知値は最優先=-1相当。array_positionのnull→0で同値)
      (array_agg(disp order by coalesce(array_position(
        array['appointment','continuing','calling','no_answer','untouched','ng','excluded'], disp), 0), id))[1] as best
    from base
    where ck <> ''
    group by ck
  )
  select jsonb_build_object(
    'total', (select count(*) from comp),
    'multi', (select count(*) from comp where events_n >= 2),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'norm', c.ck, 'name', c.name, 'contacts', c.contacts,
        'events', coalesce((
          select jsonb_agg(e.ev order by e.fid)
          from (select ev, (array_agg(id order by id))[1] as fid
                from base b2 where b2.ck = c.ck and b2.ev <> '' group by ev) e
        ), '[]'::jsonb),
        'maxScore', c.max_score, 'best', c.best, 'multi', c.events_n >= 2
      ) order by c.events_n desc, c.max_score desc, c.first_id)
      from (select * from comp order by events_n desc, max_score desc, first_id limit 400) c
    ), '[]'::jsonb)
  )
$$;
revoke execute on function public.leads_companies() from public, anon;
grant execute on function public.leads_companies() to authenticated;

-- ---- 分析(全体+展示会別スコープ: 属性別アポ率・時間帯・複数接点効果) ----
create or replace function public.leads_analysis()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with base as materialized (
    select l.id,
      coalesce(nullif(l.company_norm, ''), l.company_name, '') as ck,
      coalesce(l.raw_event, '') as ev,
      coalesce(l.priority_score, 0) as score,
      coalesce(l.disposition, 'untouched') as disp,
      l.disposition as raw_disp,
      coalesce(l.acquirer, '') as acq_raw,
      case when coalesce(l.acquirer, '') = '' then '(不明)'
           else coalesce(nullif(a.display_name, ''), l.acquirer) end as acq,
      case when coalesce(l.rank, '') = '' then '—' else l.rank end as rnk,
      case when coalesce(l.job_title, '') ~ '社長|代表|CEO|会長' then '経営者'
           when l.job_title ~ '役員|取締役' then '役員'
           when l.job_title ~ '本部長|部長|次長|部門長' then '部長'
           when l.job_title ~ '課長' then '課長'
           else '担当' end as role_b,
      case when sz.n is null or sz.n = 0 or sz.has_nan or coalesce(sz.mx, 0) = 0 then '不明'
           when sz.mx >= 1000 then '1000名+'
           when sz.mx >= 300 then '300-999名'
           when sz.mx >= 100 then '100-299名'
           else '〜99名' end as size_b,
      case when l.scanned_at is not null then extract(hour from l.scanned_at at time zone 'UTC')::int end as hr
    from leads l
    left join acquirer_aliases a on a.raw = l.acquirer and a.tenant_id = l.tenant_id
    -- 注意: JSの \d はASCII数字のみ。PGの \d は全角数字にもマッチするため [0-9] を明示する
    left join lateral (
      select count(*) as n,
             bool_or(m.g[1] !~ '[0-9]') as has_nan,
             max(case when m.g[1] ~ '[0-9]' then replace(m.g[1], ',', '')::numeric end) as mx
      from regexp_matches(coalesce(l.employee_size, ''), '[0-9,]+', 'g') as m(g)
    ) sz on true
    where l.deleted_at is null
      and (l.tenant_id in (select view_all_tenant_ids())
        or (l.tenant_id in (select current_tenant_ids()) and l.owner_user_id = (select auth.uid())))
  ),
  scope_keys as (
    select '' as ev, null::uuid as fid
    union all
    select ev, (array_agg(id order by id))[1] from base where ev <> '' group by ev
  ),
  scopes as (
    select sk.ev, sk.fid, jsonb_build_object(
      'total', (select count(*) from base b where sk.ev = '' or b.ev = sk.ev),
      'called', (select count(*) from base b where (sk.ev = '' or b.ev = sk.ev)
                 and b.raw_disp is not null and b.raw_disp <> '' and b.raw_disp <> 'untouched'),
      'appt', (select count(*) from base b where (sk.ev = '' or b.ev = sk.ev) and b.disp = 'appointment'),
      'ng', (select count(*) from base b where (sk.ev = '' or b.ev = sk.ev) and b.disp = 'ng'),
      'noans', (select count(*) from base b where (sk.ev = '' or b.ev = sk.ev) and b.disp = 'no_answer'),
      'highUntouched', (select count(*) from base b where (sk.ev = '' or b.ev = sk.ev) and b.score >= 70 and b.disp = 'untouched'),
      'acqPerf', coalesce((
        select jsonb_agg(jsonb_build_object('k', q.k, 'total', q.t, 'appt', q.a,
                 'rate', case when q.t > 0 then q.a::float / q.t else 0 end) order by q.t desc, q.fid)
        from (select b.acq as k, count(*) as t, count(*) filter (where b.disp = 'appointment') as a,
                     (array_agg(b.id order by b.id))[1] as fid
              from base b where (sk.ev = '' or b.ev = sk.ev) group by b.acq) q
      ), '[]'::jsonb),
      'hourDist', (
        select jsonb_agg(coalesce(d.c, 0) order by h.h)
        from generate_series(0, 23) as h(h)
        left join (select b.hr, count(*) as c from base b where (sk.ev = '' or b.ev = sk.ev) and b.hr is not null group by b.hr) d on d.hr = h.h
      ),
      'dispCounts', (
        select jsonb_agg(jsonb_build_object('key', dk.key, 'label', dk.label,
                 'n', (select count(*) from base b where (sk.ev = '' or b.ev = sk.ev) and b.disp = dk.key)) order by dk.ord)
        from (values (1,'untouched','未着手'),(2,'calling','架電中'),(3,'no_answer','不通'),(4,'continuing','継続'),
                     (5,'appointment','アポ獲得'),(6,'ng','NG(お断り)'),(7,'excluded','対象外')) as dk(ord, key, label)
      ),
      'byRank', coalesce((
        select jsonb_agg(jsonb_build_object('k', q.k, 'total', q.t, 'appt', q.a,
                 'rate', case when q.t > 0 then q.a::float / q.t else 0 end) order by q.t desc, q.fid)
        from (select b.rnk as k, count(*) as t, count(*) filter (where b.disp = 'appointment') as a,
                     (array_agg(b.id order by b.id))[1] as fid
              from base b where (sk.ev = '' or b.ev = sk.ev) group by b.rnk) q
      ), '[]'::jsonb),
      'byRole', coalesce((
        select jsonb_agg(jsonb_build_object('k', q.k, 'total', q.t, 'appt', q.a,
                 'rate', case when q.t > 0 then q.a::float / q.t else 0 end) order by q.t desc, q.fid)
        from (select b.role_b as k, count(*) as t, count(*) filter (where b.disp = 'appointment') as a,
                     (array_agg(b.id order by b.id))[1] as fid
              from base b where (sk.ev = '' or b.ev = sk.ev) group by b.role_b) q
      ), '[]'::jsonb),
      'bySize', coalesce((
        select jsonb_agg(jsonb_build_object('k', q.k, 'total', q.t, 'appt', q.a,
                 'rate', case when q.t > 0 then q.a::float / q.t else 0 end) order by q.t desc, q.fid)
        from (select b.size_b as k, count(*) as t, count(*) filter (where b.disp = 'appointment') as a,
                     (array_agg(b.id order by b.id))[1] as fid
              from base b where (sk.ev = '' or b.ev = sk.ev) group by b.size_b) q
      ), '[]'::jsonb)
    ) || (
      select jsonb_build_object(
        'multiCount', count(*) filter (where c.en >= 2),
        'multiAppt', count(*) filter (where c.en >= 2 and c.ap),
        'singleCount', count(*) filter (where c.en <= 1),
        'singleAppt', count(*) filter (where c.en <= 1 and c.ap))
      from (select b.ck, count(distinct b.ev) filter (where b.ev <> '') as en, bool_or(b.disp = 'appointment') as ap
            from base b where (sk.ev = '' or b.ev = sk.ev) and b.ck <> '' group by b.ck) c
    ) as scope
    from scope_keys sk
  )
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(ev order by fid) from scope_keys where ev <> ''), '[]'::jsonb),
    'scopes', (select jsonb_object_agg(ev, scope) from scopes),
    'rawAcquirers', coalesce((select jsonb_agg(x order by x) from (select distinct acq_raw as x from base where acq_raw <> '') s), '[]'::jsonb)
  )
$$;
revoke execute on function public.leads_analysis() from public, anon;
grant execute on function public.leads_analysis() to authenticated;
