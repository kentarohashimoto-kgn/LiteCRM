-- サブスク型の更新見込み(契約満了後に継続すると見込む期間と確度)
alter table opportunities add column if not exists renewal_until_month date;   -- 想定継続終了月(YYYY-MM-01, 含む)
alter table opportunities add column if not exists renewal_probability int;     -- 更新(継続)確度 0-100
comment on column opportunities.renewal_until_month is 'サブスク継続を見込む終了月(YYYY-MM-01)。契約満了の翌月〜この月までを更新見込みとして予測計上。';
comment on column opportunities.renewal_probability is 'サブスク更新(継続)確度 0-100。更新見込みの加重に使用。';
