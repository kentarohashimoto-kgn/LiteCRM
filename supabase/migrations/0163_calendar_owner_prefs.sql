-- ============================================================
-- カレンダー(案件カレンダー)の担当者表示設定
--   - 担当ごとの色は既存の profiles.avatar_color をそのまま使う
--     （色を変えるとアバター等アプリ全体にも反映される）。
--   - 不要な担当をカレンダー凡例/表示から隠すためのフラグを
--     テナント×ユーザーの memberships に持たせる。
-- ============================================================
alter table public.memberships
  add column if not exists calendar_hidden boolean not null default false;
