-- アポ獲得の記録: 獲得担当者(インサイドセールス)と獲得日を案件に保持。
alter table public.opportunities
  add column if not exists appt_acquired_by uuid references public.profiles(id),
  add column if not exists appt_acquired_on date;
