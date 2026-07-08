-- アポカレンダー用イベント: (案件×日付)で1イベントに重複排除。ヨミが無くても日程があれば表示。
--  - 商談レコードがある日はそれを採用(タイトルは商談名)。無い日は案件のアポ日を採用。
--  - kind: ヨミ=4.アポ、またはヨミ無し＆商談ログ無し → アポ(予定)。それ以外/商談ログあり → アポ済(実施)。
-- SECURITY INVOKER(既定)。呼び出しユーザーのRLSに従い、見える案件/商談のみ返す。
create or replace function public.appointment_calendar_events()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with occ as (
    -- 商談レコード由来(初回・追加すべて)。1商談=1オカレンス。
    select
      o.id as opportunity_id, o.name as opp_name, o.yomi, o.owner_user_id, a.name as account_name,
      m.id as meeting_id,
      m.meeting_at as at_ts,
      coalesce((m.meeting_at at time zone 'Asia/Tokyo')::date, m.meeting_date) as on_date,
      (m.meeting_at is not null) as timed,
      nullif(btrim(m.title), '') as mtitle
    from meetings m
      join opportunities o on o.id = m.opportunity_id and o.deleted_at is null
      join accounts a on a.id = o.account_id
    where coalesce(m.meeting_at::date, m.meeting_date) is not null

    union all
    -- 案件のアポ日(その日に商談レコードが無い場合のみ)。ヨミ不問。
    select
      o.id, o.name, o.yomi, o.owner_user_id, a.name,
      null::uuid,
      o.appointment_at,
      coalesce((o.appointment_at at time zone 'Asia/Tokyo')::date, o.first_meeting_date),
      (o.appointment_at is not null),
      null
    from opportunities o
      join accounts a on a.id = o.account_id
    where o.deleted_at is null
      and coalesce((o.appointment_at at time zone 'Asia/Tokyo')::date, o.first_meeting_date) is not null
      and not exists (
        select 1 from meetings m
        where m.opportunity_id = o.id
          and coalesce((m.meeting_at at time zone 'Asia/Tokyo')::date, m.meeting_date)
              = coalesce((o.appointment_at at time zone 'Asia/Tokyo')::date, o.first_meeting_date)
      )
  ),
  ev as (
    select
      case
        when occ.yomi = '4.アポ' then 'appt'
        when occ.yomi is null and occ.meeting_id is null then 'appt'
        else 'done'
      end as kind,
      occ.opportunity_id, occ.meeting_id, occ.account_name, occ.opp_name, occ.yomi,
      occ.owner_user_id,
      coalesce(p.display_name, p.email, '—') as owner_name,
      p.avatar_color as owner_color,
      occ.at_ts, occ.on_date, occ.timed, occ.mtitle
    from occ
      left join profiles p on p.id = occ.owner_user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind,
    'opportunity_id', opportunity_id,
    'meeting_id', meeting_id,
    'account_name', account_name,
    'opp_name', opp_name,
    'yomi', yomi,
    'owner_user_id', owner_user_id,
    'owner_name', owner_name,
    'owner_color', owner_color,
    'at', at_ts,
    'on_date', on_date,
    'timed', timed,
    'title', coalesce(mtitle, case when kind = 'appt' then 'アポ' else '初回商談' end),
    'meeting_count', 0
  ) order by on_date), '[]'::jsonb)
  from ev
  where on_date is not null;
$$;
