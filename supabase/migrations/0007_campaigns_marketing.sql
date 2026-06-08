-- =====================================================================
-- 施策(マーケティングチャネル)分析の拡張
--
-- 目的: 展示会をはじめとする「アポ前のリード獲得施策」を施策インスタンス単位で
--       管理し、リード→アポ→成約→売上のファネルとCPL/CPA/CPO/ROIを分析する。
--       campaigns を施策インスタンス(=1展示会/1セミナー 等)のマスタとして拡張。
--
-- 設計メモ:
--   - channel で施策種別を区別(exhibition/agency/seminar/exec_appt_bt/
--     exec_appt_rm/whitelist_call/media_ipros/media_aismiley/sns/networking/other)。
--   - リード数・アポ数・架電数・費用は施策側の実績値として保持(CRMに個票が無いため)。
--   - 成約数・売上は CRM の opportunities から集計する(=正本はCRM)。
--     管理表の記載値は reported_deals/reported_revenue に参考保持。
--   - opportunities.campaign_id で商談を施策インスタンスへ紐付け。
--     campaign_estimated=true は日付ベースの自動推定リンク(後で手動修正可)。
-- =====================================================================

-- ---- campaigns: 施策インスタンスとして拡張 ----
alter table campaigns
  add column if not exists channel          text not null default 'other',
  add column if not exists organizer        text,
  add column if not exists venue            text,
  add column if not exists event_status     text not null default 'planned', -- done / applied / planned
  add column if not exists event_date       date,
  add column if not exists end_date         date,
  add column if not exists days             integer,
  add column if not exists expected_leads   integer,
  add column if not exists actual_leads     integer,
  add column if not exists action_count     integer,
  add column if not exists appointments     integer,
  add column if not exists reported_deals   integer,
  add column if not exists reported_revenue numeric,
  add column if not exists cost             numeric,
  add column if not exists sort_order       integer,
  add column if not exists notes            text;

-- ---- opportunities: 施策インスタンスへの紐付け ----
alter table opportunities
  add column if not exists campaign_id        uuid references campaigns(id),
  add column if not exists campaign_estimated boolean not null default false;

create index if not exists idx_campaigns_tenant_channel on campaigns(tenant_id, channel);
create index if not exists idx_campaigns_event_date on campaigns(tenant_id, event_date);
create index if not exists idx_opps_campaign on opportunities(campaign_id);
