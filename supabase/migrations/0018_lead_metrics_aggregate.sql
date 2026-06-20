-- リード集計をSQL側で実施(行を転送せず高速化)。security invoker でRLS準拠。
create or replace function lead_metrics() returns jsonb language sql stable as $$
  with l as (select id, acquired_at, disposition, lead_source_id from leads),
  won_leads as (select distinct lead_id from opportunities where lead_id is not null and status = 'won')
  select jsonb_build_object(
    'total', (select count(*) from l),
    'byMonth', (select coalesce(jsonb_object_agg(m, c), '{}'::jsonb) from (select to_char(date_trunc('month', acquired_at), 'YYYY-MM-01') m, count(*) c from l where acquired_at is not null group by 1) x),
    'apptByMonth', (select coalesce(jsonb_object_agg(m, c), '{}'::jsonb) from (select to_char(date_trunc('month', acquired_at), 'YYYY-MM-01') m, count(*) c from l where disposition = 'appointment' and acquired_at is not null group by 1) x),
    'wonByMonth', (select coalesce(jsonb_object_agg(m, c), '{}'::jsonb) from (select to_char(date_trunc('month', acquired_at), 'YYYY-MM-01') m, count(*) c from l where id in (select lead_id from won_leads) and acquired_at is not null group by 1) x),
    'bySource', (select coalesce(jsonb_object_agg(s, c), '{}'::jsonb) from (select lead_source_id::text s, count(*) c from l where lead_source_id is not null group by 1) x)
  )
$$;
