-- アポカレンダー用イベント: アポ(予定=ヨミ4.アポ) と アポ済(実施=商談レコード or 初回商談日) を統合。
-- SECURITY INVOKER(既定)。呼び出しユーザーのRLSに従い、見える案件/商談のみ返す。
create or replace function public.appointment_calendar_events()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with ev as (
    -- アポ(予定): ヨミ=4.アポ
    select
      'appt'::text as kind,
      o.id as opportunity_id,
      null::uuid as meeting_id,
      a.name as account_name,
      o.name as opp_name,
      o.yomi,
      o.owner_user_id,
      coalesce(p.display_name, p.email, '—') as owner_name,
      p.avatar_color as owner_color,
      o.appointment_at as at_ts,
      coalesce((o.appointment_at at time zone 'Asia/Tokyo')::date, o.first_meeting_date) as on_date,
      (o.appointment_at is not null) as timed,
      'アポ'::text as title,
      (select count(*) from meetings mm where mm.opportunity_id = o.id)::int as meeting_count
    from opportunities o
      join accounts a on a.id = o.account_id
      left join profiles p on p.id = o.owner_user_id
    where o.deleted_at is null and o.yomi = '4.アポ'
      and (o.appointment_at is not null or o.first_meeting_date is not null)

    union all
    -- アポ済(実施): 商談レコード(初回・追加すべて)
    select
      'done', o.id, m.id, a.name, o.name, o.yomi,
      o.owner_user_id, coalesce(p.display_name, p.email, '—'), p.avatar_color,
      m.meeting_at,
      coalesce((m.meeting_at at time zone 'Asia/Tokyo')::date, m.meeting_date),
      (m.meeting_at is not null),
      coalesce(nullif(btrim(m.title), ''), '商談'),
      (select count(*) from meetings mm where mm.opportunity_id = o.id)::int
    from meetings m
      join opportunities o on o.id = m.opportunity_id and o.deleted_at is null
      join accounts a on a.id = o.account_id
      left join profiles p on p.id = o.owner_user_id
    where coalesce(m.meeting_at::date, m.meeting_date) is not null

    union all
    -- アポ済(実施): 商談レコードが無いが初回商談日がある案件(ヨミがアポ以外)
    select
      'done', o.id, null, a.name, o.name, o.yomi,
      o.owner_user_id, coalesce(p.display_name, p.email, '—'), p.avatar_color,
      null::timestamptz,
      o.first_meeting_date,
      false,
      '初回商談',
      0
    from opportunities o
      join accounts a on a.id = o.account_id
      left join profiles p on p.id = o.owner_user_id
    where o.deleted_at is null
      and o.yomi is distinct from '4.アポ'
      and o.first_meeting_date is not null
      and not exists (select 1 from meetings m where m.opportunity_id = o.id and coalesce(m.meeting_at::date, m.meeting_date) is not null)
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
    'title', title,
    'meeting_count', meeting_count
  ) order by on_date), '[]'::jsonb)
  from ev
  where on_date is not null;
$$;
