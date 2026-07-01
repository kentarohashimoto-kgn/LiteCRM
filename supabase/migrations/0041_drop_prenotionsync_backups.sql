-- 不要データの削除: Notion取込前バックアップ3表を破棄。
-- 取込は成功済みで現行データ(opportunities 681 / meetings 626 / billing 43)が
-- これらスナップショット(opps 612 / meetings 0 / billing 43)の上位互換のため、
-- 一時退避データを残さずセキュリティリスクを排除する。
drop table if exists public._bk_opportunities_prenotionsync;
drop table if exists public._bk_meetings_prenotionsync;
drop table if exists public._bk_billing_schedules_prenotionsync;
