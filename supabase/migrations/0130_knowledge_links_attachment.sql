-- ノウハウ・事例に「参考URL(複数・説明付き)」と「添付ファイル1つ(説明付き)」を追加。
--   reference_links: [{ "url": "...", "label": "..."|null }, ...]
--   attachment_*: 添付1件のメタ（実体は attachments バケットに保存し署名URLで参照）。
alter table public.knowledge_entries
  add column if not exists reference_links jsonb not null default '[]'::jsonb,
  add column if not exists attachment_path  text,
  add column if not exists attachment_name  text,
  add column if not exists attachment_note  text,
  add column if not exists attachment_type  text,
  add column if not exists attachment_size  bigint;
