-- 案件予測(buyer-journeyフェーズ)。初回商談時に営業担当が入力必須にする。
-- 情報収集/比較検討/詳細検討/提案/見積/未来客。個人別ファネルの軸にも使う。
alter table public.opportunities
  add column if not exists deal_phase text;  -- info_gathering/comparison/detailed_review/proposal/estimate/future
