-- 全置換インポートで案件を入替える際、請求(サブスク)を保全するため
-- billing_schedules.opportunity_id を NULL 許可に変更(account_idで紐づくため案件削除後も残せる)。
-- これが NOT NULL だと purge_tenant_opportunities() のNULL化で制約違反になっていた。
-- ロールバック: alter table billing_schedules alter column opportunity_id set not null;
alter table billing_schedules alter column opportunity_id drop not null;
