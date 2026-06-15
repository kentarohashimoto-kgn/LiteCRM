-- 姓・名を分離して保持(取込時に別管理。ダウンロードで姓名/姓+名を選べるように)
alter table leads add column if not exists last_name text;
alter table leads add column if not exists first_name text;
