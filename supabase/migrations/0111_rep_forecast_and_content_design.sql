-- (1) 案件ごとの「営業マン自身の予測」入力欄(週報の要望: 成約タイミングは何月か/売上額は/あと何回商談が必要か)。
--     既存の expected_close_date(会社側の見込み)とは別に、担当の読みを持つ(加算)。
alter table public.opportunities
  add column if not exists rep_close_month text,          -- 例 '2026-09'(YYYY-MM)
  add column if not exists rep_amount_forecast numeric,   -- 担当の売上予測(円)
  add column if not exists rep_meetings_left int;         -- 成約まであと何回商談が必要か
comment on column public.opportunities.rep_close_month is '担当の読み: 成約タイミング(YYYY-MM)';
comment on column public.opportunities.rep_amount_forecast is '担当の読み: 売上額(円)';
comment on column public.opportunities.rep_meetings_left is '担当の読み: 成約まで必要な残商談回数';

-- (2) B8: 記事のClaudeデザイン連携フラグ。連携できない場合は手動コピペ運用。
alter table public.content_ideas
  add column if not exists design_status text not null default 'none'
    check (design_status in ('none','ready','linked','manual'));
comment on column public.content_ideas.design_status is 'デザイン連携: none=未/ready=連携待ち/linked=Claudeデザイン連携済/manual=手動コピペで作成';
