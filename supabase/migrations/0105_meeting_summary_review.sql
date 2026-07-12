-- AI要約の「人が確認した」状態。確認キュー(今朝の確認)で未確認の要約を絞り込む。
alter table public.meetings
  add column if not exists ai_summary_reviewed_at timestamptz,
  add column if not exists ai_summary_reviewed_by uuid references auth.users(id);
comment on column public.meetings.ai_summary_reviewed_at is 'AI要約を人が確認した日時(確認キュー)。NULL=未確認';
comment on column public.meetings.ai_summary_reviewed_by is 'AI要約を確認したユーザー';
