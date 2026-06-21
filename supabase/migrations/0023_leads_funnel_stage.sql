-- アポ前ファネルのステージ(新規→相談候補MQL→商談候補SQL→アポ / 育成・対象外)
alter table leads add column if not exists funnel_stage text not null default 'new';
update leads set funnel_stage = case
  when disposition = 'appointment' then 'appointment'
  when disposition = 'excluded' then 'excluded'
  when disposition = 'ng' then 'excluded'
  when disposition = 'continuing' then 'mql'
  else 'new' end
where funnel_stage = 'new';
