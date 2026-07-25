-- =====================================================================
-- P1.6 商談録音のGoogleドライブ保存対応。
--   新規録音はドライブ(601_CRM_資料庫/90_商談録音)に保存し、drive_file_id を持つ。
--   既存のSupabase保存分(storage_path)は従来通り動作し、30日で自動削除される。
--   マスターはドライブ。30日経過後の実体削除ポリシーは変更なし(文字起こしは永続)。
-- =====================================================================

alter table public.meeting_recordings
  add column if not exists drive_file_id text;

comment on column public.meeting_recordings.drive_file_id is
  'Googleドライブ保存時のファイルID(P1.6)。storage_pathとどちらか一方を使用';
