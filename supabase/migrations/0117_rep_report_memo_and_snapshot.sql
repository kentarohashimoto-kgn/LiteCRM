-- 営業マン別週報の改善:
-- (1) 案件ごとの1行メモ(状況コメント共有)。会社側notesとは別に、週報用の短い状況メモ。
alter table public.opportunities add column if not exists rep_status_note text;
comment on column public.opportunities.rep_status_note is '週報用の1行状況メモ(担当のコメント共有)';

-- (2) 週報保存時に、自動集計サマリー(目標/実績/見込み/パイプライン/ファネル/案件)を丸ごと固定。
alter table public.weekly_rep_reports add column if not exists payload jsonb;
comment on column public.weekly_rep_reports.payload is '保存時点の自動集計サマリーのスナップショット';
