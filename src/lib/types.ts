/**
 * CATORCE Sales OS - ドメイン型定義
 * 要件定義書 9章 / 13章のテーブル定義に対応。
 * 全業務エンティティは tenant_id を持つ(マルチテナント前提)。
 */

export type UUID = string;

export type Role =
  | "owner"
  | "admin"
  | "sales_manager"
  | "sales_rep"
  | "external_sales"
  | "partner"
  | "delivery"
  | "finance"
  | "viewer";

export type OpportunityStage =
  | "lead_acquired"
  | "contacted"
  | "meeting_scheduled"
  | "meeting_done"
  | "needs_confirmed"
  | "proposal_preparing"
  | "proposal_sent"
  | "internal_review"
  | "verbal_commit"
  | "won"
  | "lost"
  | "on_hold";

export type ForecastCategory =
  | "commit"
  | "best_case"
  | "pipeline"
  | "upside"
  | "omitted";

export type OpportunityStatus = "open" | "won" | "lost" | "on_hold";

export type ActivityType =
  | "meeting"
  | "call"
  | "email"
  | "dm"
  | "proposal"
  | "estimate"
  | "follow_up"
  | "note"
  | "internal_memo";

export type TaskStatus = "todo" | "done" | "cancelled" | "overdue";
export type Priority = "high" | "middle" | "low";
export type RiskLevel = "low" | "middle" | "high";

/** 案件の分類 */
export type OpportunityCategory =
  | "development" // 開発
  | "advisory_subscription" // 顧問・サブスク
  | "training" // 研修
  | "other"; // その他

/** 施策(マーケティングチャネル)種別。展示会を起点に他施策へ拡張する。 */
export type ChannelType =
  | "exhibition"
  | "agency"
  | "seminar"
  | "exec_appt_bt"
  | "exec_appt_rm"
  | "whitelist_call"
  | "media_ipros"
  | "media_aismiley"
  | "sns"
  | "networking"
  | "other";

/** 施策インスタンスのステータス(実施済み/申込み済/予定) */
export type CampaignEventStatus = "done" | "applied" | "planned";

export interface Tenant {
  id: UUID;
  name: string;
  slug: string;
  status: string;
}

export interface User {
  id: UUID;
  name: string;
  email: string;
  avatarColor?: string;
}

export interface Membership {
  id: UUID;
  tenant_id: UUID;
  user_id: UUID;
  role: Role;
  status: string;
  rep_status?: "continuing" | "terminated" | "hold" | "pending";
}

export interface RepTarget {
  id: UUID;
  tenant_id: UUID;
  user_id: UUID;
  target_month: string; // YYYY-MM-01
  target_amount: number;
}

/** セミナーアンケート回答(別管理)。 */
export interface SeminarResponse {
  id: UUID;
  tenant_id: UUID;
  campaign_id?: UUID;
  seminar_name?: string;
  responded_at?: string;
  email?: string;
  name?: string;
  company?: string;
  company_norm?: string;
  phone?: string;
  employee_size?: string;
  job_title?: string;
  satisfaction?: number;
  satisfaction_reason?: string;
  understanding?: number;
  challenges?: string;
  ai_usage?: string;
  follow_up?: string;
  comment?: string;
  consent?: boolean;
  created_at: string;
}

export interface Account {
  id: UUID;
  tenant_id: UUID;
  owner_user_id?: UUID;
  name: string;
  industry?: string;
  employee_size?: string;
  revenue_size?: string;
  area?: string;
  status: "prospect" | "customer" | "inactive";
  priority?: "A" | "B" | "C";
  rank?: "S" | "A" | "B" | "C" | "D";
  focus?: "critical" | "important" | "normal" | "low" | "hold";
  potential?: "high" | "middle" | "low";
  website_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: UUID;
  tenant_id: UUID;
  account_id: UUID;
  name: string;
  department?: string;
  title?: string;
  email?: string;
  phone?: string;
  decision_role?: "decision_maker" | "influencer" | "user" | "referrer";
  interest_topics?: string[];
  temperature?: "high" | "middle" | "low";
  last_contacted_at?: string;
  next_contact_date?: string;
  notes?: string;
}

export interface LeadSource {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  status: string;
}

/**
 * 施策インスタンス(=1展示会 / 1セミナー など)。
 * リード数・アポ数・架電数・費用は施策側の実績(CRMに個票が無いため campaign に保持)。
 * 成約数・売上は紐づく opportunities から集計する(=正本はCRM)。
 */
export interface Campaign {
  id: UUID;
  tenant_id: UUID;
  lead_source_id?: UUID;
  channel: ChannelType;
  name: string;
  organizer?: string;
  venue?: string;
  event_status: CampaignEventStatus;
  event_date?: string;
  end_date?: string;
  days?: number;
  expected_leads?: number;
  actual_leads?: number;
  action_count?: number;
  appointments?: number;
  reported_deals?: number;
  reported_revenue?: number;
  cost?: number;
  sort_order?: number;
  notes?: string;
  status: string;
  created_at: string;
}

export interface ProductCategory {
  id: UUID;
  tenant_id: UUID;
  name: string;
}

export interface Product {
  id: UUID;
  tenant_id: UUID;
  category_id?: UUID;
  category?: string;
  name: string;
  description?: string;
  default_price?: number;
  default_gross_profit_rate?: number;
  is_recurring: boolean;
  status: "active" | "inactive" | "testing";
  release_date?: string;
  notes?: string;
}

export interface Lead {
  id: UUID;
  tenant_id: UUID;
  account_id?: UUID;
  contact_id?: UUID;
  lead_source_id?: UUID;
  campaign_id?: UUID;
  owner_user_id?: UUID;
  primary_product_id?: UUID;
  title: string;
  status: "new" | "contacted" | "qualified" | "disqualified" | "converted";
  rank?: string;
  acquired_at: string;
  first_contacted_at?: string;
  converted_at?: string;
  disqualified_reason?: string;
  notes?: string;
  created_at: string;
  // リード管理拡張
  company_name?: string;
  company_norm?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  department?: string;
  job_title?: string;
  industry?: string;
  employee_size?: string;
  prefecture?: string;
  priority_score?: number;
  call_owner?: string;
  disposition?: string;
  tags?: string;
  raw_event?: string;
  deal_owner_name?: string;
  acquirer?: string;
  scanned_at?: string;
  import_batch_id?: UUID;
  extra?: Record<string, string>;
  revenue_size?: string;
  role_level?: string;
  needs?: string;
  timing?: string;
  authority?: string;
  budget_band?: string;
  budget_amount?: number;
  priority_base?: number;
}

export interface AcquirerAlias {
  id: UUID;
  tenant_id: UUID;
  raw: string;
  display_name?: string;
}

export interface LeadImportBatch {
  id: UUID;
  tenant_id: UUID;
  raw_event?: string;
  label?: string;
  source_name?: string;
  row_count: number;
  created_by?: UUID;
  created_at: string;
}

export interface Opportunity {
  id: UUID;
  tenant_id: UUID;
  account_id: UUID;
  contact_id?: UUID;
  lead_id?: UUID;
  owner_user_id: UUID;
  name: string;
  stage: OpportunityStage;
  forecast_category: ForecastCategory;
  /** Notion原本の「ヨミ」フィールド値(例: 4.アポ / 0.受注)。 */
  yomi?: string;
  /** 初回商談日(初回営業日)。カレンダーのアポ予定日に使用。 */
  first_meeting_date?: string;
  amount: number;
  gross_profit?: number;
  gross_profit_rate?: number;
  probability: number;
  expected_close_date?: string;
  expected_revenue_month?: string;
  category?: OpportunityCategory;
  primary_product_id?: UUID;
  lead_source_id?: UUID;
  campaign_id?: UUID;
  campaign_estimated?: boolean;
  next_action_date?: string;
  next_action_text?: string;
  last_activity_at?: string;
  status: OpportunityStatus;
  lost_reason?: string;
  win_reason?: string;
  risk_level?: RiskLevel;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: UUID;
  tenant_id: UUID;
  account_id?: UUID;
  contact_id?: UUID;
  opportunity_id?: UUID;
  owner_user_id: UUID;
  activity_type: ActivityType;
  title: string;
  body?: string;
  activity_at: string;
  next_action_date?: string;
  next_action_text?: string;
  created_at: string;
}

export interface Task {
  id: UUID;
  tenant_id: UUID;
  opportunity_id?: UUID;
  account_id?: UUID;
  assigned_to: UUID;
  created_by: UUID;
  title: string;
  description?: string;
  due_date: string;
  status: TaskStatus;
  priority?: Priority;
  completed_at?: string;
}

/** 商談(meetings): 案件配下の個別商談(1回ごと)。 */
export interface Meeting {
  id: UUID;
  tenant_id: UUID;
  opportunity_id: UUID;
  account_id?: UUID;
  owner_user_id: UUID;
  title: string;
  meeting_date?: string;
  meeting_at?: string;
  method?: string;
  summary?: string;
  next_action_date?: string;
  next_action_text?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

/** 請求スケジュール(売上計画)。受注とは別に請求(売上)の予定を行単位で管理。 */
export interface BillingSchedule {
  id: UUID;
  tenant_id: UUID;
  opportunity_id: UUID;
  account_id?: UUID;
  kind: "one_time" | "recurring";
  billing_date?: string;
  amount: number;
  recurring_start_month?: string;
  recurring_end_month?: string;
  note?: string;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface StageHistory {
  id: UUID;
  tenant_id: UUID;
  opportunity_id: UUID;
  from_stage?: OpportunityStage;
  to_stage: OpportunityStage;
  changed_by?: UUID;
  reason?: string;
  changed_at: string;
}

export interface SalesTarget {
  id: UUID;
  tenant_id: UUID;
  target_month: string; // YYYY-MM-01
  target_amount: number;
  target_gross_profit?: number;
  target_deals?: number;
  target_appointments?: number;
  target_leads?: number;
}

export interface ForecastSnapshot {
  id: UUID;
  tenant_id: UUID;
  snapshot_date: string;
  period_month: string;
  commit_amount: number;
  best_case_amount: number;
  pipeline_amount: number;
  upside_amount: number;
  weighted_amount: number;
  target_amount: number;
  gap_amount: number;
}
