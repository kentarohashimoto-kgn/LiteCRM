-- 0133: 名刺情報にメモ2（会社詳細情報）を追加
--   交流会名簿の事業内容・自社PRなど、名刺本体とは別の会社側の詳細情報を保持する。
--   変更履歴は既存の trg_audit_business_cards（fn_audit_row）が自動で記録する。
alter table public.business_cards add column if not exists memo2 text;
