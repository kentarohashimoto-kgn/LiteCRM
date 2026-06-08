-- =====================================================================
-- 商談に「ヨミ(原本値)」と「初回商談日」を追加
--
-- 背景: Notion取込時、原本の ヨミ フィールド(例: 0.受注 / 4.アポ / 3.C(30%) …)を
--       内部の forecast_category へ変換していたが、原本値そのものを保持したい。
--       また初回商談日(初回営業日)をカレンダーの「アポ予定日」に用いる。
-- =====================================================================

alter table opportunities
  add column if not exists yomi               text,
  add column if not exists first_meeting_date date;

create index if not exists idx_opps_first_meeting on opportunities(tenant_id, first_meeting_date);
