-- D-1c HP問合せの流入元メディア/流入詳細/集計タグ。
-- 「HP問合せ」タブで、受付日時・流入元メディア(カトルセHP/キャリプラ/Aicafe 等)・
-- 流入詳細(資料名/無料相談 等)・集計用タグを一覧/集計できるようにするための列。
--
--  inquiry_media : 流入元メディア(どのサイト/媒体からか)。フォームの media で送る。
--  inquiry_tags  : 集計用タグ(資料種別など)。フォームの tags(カンマ区切り)を配列で保持。
--  受付日時は既存の created_at を使用(追加不要)。
--  流入詳細は既存の raw_event(=フォームの source)を使用。

alter table leads add column if not exists inquiry_media text;
alter table leads add column if not exists inquiry_tags text[];

create index if not exists idx_leads_inquiry_media on leads (inquiry_media) where inquiry_media is not null;
