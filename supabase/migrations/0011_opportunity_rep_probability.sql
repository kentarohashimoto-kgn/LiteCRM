-- 担当者による受注予測確率(ヨミ/ステージ確度とは別の、担当者の主観確率 0-100)
alter table opportunities add column if not exists rep_probability int;
comment on column opportunities.rep_probability is '担当者の受注予測確率(0-100)。ヨミ・ステージ由来のprobabilityとは別。';
