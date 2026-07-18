-- =====================================================================
-- AI-PMO: 営業分析(流入元)モードの追加
--   1) pmo_reports.mode に 'sales' を許可(CHECK制約の張り替え)
--   2) 流入元別の月次成果(受注・アポ)とパイプラインを返すRPC pmo_channel_stats
--      - 展示会/BT/パートナー/自社営業/紹介 等の右肩上がり判定・ROI評価に使う
--      - SECURITY DEFINER + テナントガード(認証ユーザーは自テナントのみ / service_roleは指定可)
-- =====================================================================

-- 1) mode に 'sales' を許可
alter table public.pmo_reports drop constraint if exists pmo_reports_mode_check;
alter table public.pmo_reports
  add constraint pmo_reports_mode_check
  check (mode in ('retrospective','planning','project','executive','sales'));

-- 2) 流入元別の月次成果 + オープンパイプライン
create or replace function public.pmo_channel_stats(p_tenant uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v uuid[] := array(select current_tenant_ids());
  m0 date := date_trunc('month', current_date) - interval '11 months';
  result jsonb;
begin
  -- 認証ユーザーは自テナントのみ。service_role(current_tenant_idsが空)は指定テナントを許可。
  if array_length(v,1) is not null and not (p_tenant = any(v)) then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object(
    'won_by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', mk, 'source', source, 'won_amt', won_amt, 'won_cnt', won_cnt) order by mk, source)
      from (
        select to_char(date_trunc('month', coalesce(o.expected_close_date, o.expected_revenue_month::date)),'YYYY-MM') as mk,
               s.name as source, coalesce(sum(o.amount),0)::bigint as won_amt, count(*)::int as won_cnt
        from opportunities o join lead_sources s on s.id = o.lead_source_id
        where o.tenant_id = p_tenant and o.deleted_at is null and o.status = 'won'
          and coalesce(o.expected_close_date, o.expected_revenue_month::date) >= m0
        group by 1, 2
      ) w
    ), '[]'::jsonb),
    'appt_by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', mk, 'source', source, 'appt_cnt', appt_cnt) order by mk, source)
      from (
        select to_char(date_trunc('month', o.first_meeting_date),'YYYY-MM') as mk,
               s.name as source, count(*)::int as appt_cnt
        from opportunities o join lead_sources s on s.id = o.lead_source_id
        where o.tenant_id = p_tenant and o.deleted_at is null and o.first_meeting_date is not null
          and o.first_meeting_date >= m0
        group by 1, 2
      ) a
    ), '[]'::jsonb),
    'open_by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source', source, 'open_cnt', open_cnt, 'open_amt', open_amt, 'weighted', weighted) order by open_amt desc)
      from (
        select s.name as source, count(*)::int as open_cnt, coalesce(sum(o.amount),0)::bigint as open_amt,
               coalesce(sum(o.amount * o.probability / 100.0),0)::bigint as weighted
        from opportunities o join lead_sources s on s.id = o.lead_source_id
        where o.tenant_id = p_tenant and o.deleted_at is null and o.status = 'open'
          and (o.yomi is null or o.yomi !~ '^(0\.|7\.|8\.)')
        group by 1
      ) op
    ), '[]'::jsonb)
  ) into result;

  return coalesce(result, '{}'::jsonb);
end $$;

revoke execute on function public.pmo_channel_stats(uuid) from public, anon;
grant execute on function public.pmo_channel_stats(uuid) to authenticated, service_role;
