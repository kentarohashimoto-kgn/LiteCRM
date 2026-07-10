-- 既存案件の未登録商談をバックフィル。
--
-- 背景: 以前はアポ登録が案件(opportunities)のみを作成し、配下の商談(meetings)を
--   作っていなかった。アポ登録時に商談も同時作成するよう修正済みだが、
--   それ以前に登録された「初回商談の日程(first_meeting_date / appointment_at)が
--   あるのに配下の商談レコードが無い案件」が残っている。
--   本マイグレーションはそれらに初回商談(アポ)レコードを1件ずつ補完する。
--
-- 冪等: 既に商談が1件でもある案件は対象外(NOT EXISTS)。再実行しても二重作成しない。
-- 商談の created_at(=商談登録日)は案件の created_at に合わせ、実際の登録時期を保つ。

insert into public.meetings (
  tenant_id, opportunity_id, account_id, owner_user_id,
  title, meeting_date, meeting_at, next_action_date, next_action_text,
  pre_info, created_by, created_at, updated_at
)
select
  o.tenant_id,
  o.id,
  o.account_id,
  o.owner_user_id,
  '初回商談（アポ）',
  coalesce((o.appointment_at at time zone 'Asia/Tokyo')::date, o.first_meeting_date),
  o.appointment_at,
  coalesce((o.appointment_at at time zone 'Asia/Tokyo')::date, o.first_meeting_date),
  '初回商談（アポ）'
    || case when o.appointment_at is not null
            then ' ' || to_char(o.appointment_at at time zone 'Asia/Tokyo', 'HH24:MI')
            else '' end,
  o.pre_research,
  o.owner_user_id,
  o.created_at,
  now()
from public.opportunities o
where o.deleted_at is null
  and (o.first_meeting_date is not null or o.appointment_at is not null)
  and not exists (select 1 from public.meetings m where m.opportunity_id = o.id);
