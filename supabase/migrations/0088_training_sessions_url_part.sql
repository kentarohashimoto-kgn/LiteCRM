-- AI講師スケジュール: 会議URLと「全体研修のどの部分か(Day表記)」を追加。
alter table training_sessions add column if not exists meeting_url text;
alter table training_sessions add column if not exists session_part text;
