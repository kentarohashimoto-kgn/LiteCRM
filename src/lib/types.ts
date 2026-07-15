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
  | "back_office"
  | "hr"
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
  engagement_score?: number;
  engagement_rank?: string;
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

/** 名刺情報（Eight等から取込・組織共有）。owner_user_id=名刺交換者。 */
export interface BusinessCard {
  id: UUID;
  tenant_id: UUID;
  owner_user_id: UUID;
  company_name: string;
  department?: string | null;
  title?: string | null;
  full_name: string;
  last_name?: string | null;
  first_name?: string | null;
  email?: string | null;
  postal_code?: string | null;
  address?: string | null;
  tel_company?: string | null;
  tel_department?: string | null;
  tel_direct?: string | null;
  fax?: string | null;
  mobile_phone?: string | null;
  url?: string | null;
  exchanged_on?: string | null;
  eight_connected: boolean;
  rank?: string | null;
  memo?: string | null;
  tags: string[];
  /** アクション優先度（あとで対応する名刺のマークアップ） */
  priority?: "high" | "medium" | "low" | null;
  /** 任意タグ（Eight由来のイベントタグ tags とは別管理） */
  user_tags?: string[];
  source: string;
  account_id?: UUID | null;
  contact_id?: UUID | null;
  match_type?: "email" | "company_contact" | "company" | "manual" | null;
  matched_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** 名刺の社内コメント。 */
export interface BusinessCardComment {
  id: UUID;
  tenant_id: UUID;
  card_id: UUID;
  author_user_id: UUID;
  body: string;
  created_at: string;
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

/** Sランク顧客(エンタープライズ攻略) — 会社単位攻略 + 部署 + キーマン。 */
export interface SrankAccount {
  id: UUID;
  tenant_id: UUID;
  account_id?: UUID;
  company_name: string;
  srank_reason?: string;
  revenue_potential?: number;
  target_sales?: number;
  longterm_target?: number;
  deal_status: string;
  stage: string;
  exec_involved: boolean;
  manager_involved: boolean;
  priority_month?: string;
  exec_contact: boolean;
  exec_contact_person?: string;
  exec_contact_route?: string;
  exec_theme?: string;
  company_issue?: string;
  next_upper_person?: string;
  intro_request_status?: string;
  next_exec_contact_date?: string;
  next_dept_contact_date?: string;
  owner_user_id?: UUID;
  created_at: string;
  updated_at: string;
}
export interface SrankDepartment {
  id: UUID;
  tenant_id: UUID;
  srank_account_id: UUID;
  name: string;
  responsible?: string;
  keyperson?: string;
  decision_maker?: string;
  promoter?: string;
  issue?: string;
  interest_products?: string;
  budget_status?: string;
  timing?: string;
  proposal_status: string;
  amount: number;
  expansion_potential?: string;
  next_action?: string;
  next_action_date?: string;
  updated_at: string;
}
export interface SrankKeyperson {
  id: UUID;
  tenant_id: UUID;
  srank_account_id: UUID;
  name: string;
  department?: string;
  title?: string;
  role?: string;
  influence?: string;
  relationship?: string;
  interest?: string;
  last_contact_date?: string;
  next_contact_date?: string;
  intro_depts?: string;
  concern?: string;
  next_request?: string;
  updated_at: string;
}

/** 既存顧客深耕(アップセル)拡張。既存 accounts を参照。 */
export interface AccountNurture {
  id: UUID;
  tenant_id: UUID;
  account_id: UUID;
  nurture_stage: string;
  relationship?: string;
  deep_owner_user_id?: UUID;
  next_contact_date?: string;
  additional_proposal?: string;
  expansion_depts?: string;
  exec_contact: boolean;
  this_year_additional?: number;
  next_proposal?: string;
  services_done?: string;
  notes?: string;
  updated_at: string;
}
export interface NurtureTouch {
  id: UUID;
  tenant_id: UUID;
  account_id: UUID;
  touched_at?: string;
  method?: string;
  summary?: string;
  reaction?: string;
  next_date?: string;
  owner_user_id?: UUID;
  created_at: string;
}

/** 展示会選定の候補(マーケが入力→自動スコア/ランク→幹部が最終決定)。 */
export interface ExhibitionCandidate {
  id: UUID;
  tenant_id: UUID;
  organizer?: string;
  name: string;
  venue?: string;
  event_date?: string;
  days?: number;
  status: string;
  has_seminar: boolean;
  theme_fit: string;
  expected_visitors?: number;
  expected_leads?: number;
  booth_cost?: number;
  staff_cost?: number;
  other_cost?: number;
  expected_deals?: number;
  expected_unit_price?: number;
  expected_revenue?: number;
  decision: string;
  notes?: string;
  owner_user_id?: UUID;
  created_at: string;
  updated_at: string;
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
  last_name?: string;
  first_name?: string;
  email?: string;
  phone?: string;
  mobile_phone?: string;
  department?: string;
  job_title?: string;
  industry?: string;
  employee_size?: string;
  prefecture?: string;
  priority_score?: number;
  call_owner?: string;
  disposition?: string;
  funnel_stage?: string;
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

/** 接点(エンゲージメントの基盤)。あらゆる接触を人(メール)/企業単位で記録。 */
export interface Touchpoint {
  id: UUID;
  tenant_id: UUID;
  email?: string;
  company_norm?: string;
  account_id?: UUID;
  lead_id?: UUID;
  type: string;
  weight: number;
  occurred_at?: string;
  source?: string;
  meta?: Record<string, unknown>;
  created_at: string;
}

/** 人単位のエンゲージメント(接点から再計算)。 */
export interface PersonEngagement {
  tenant_id: UUID;
  email: string;
  score: number;
  rank?: string;
  touch_count: number;
  types: string[];
  last_touch_at?: string;
  updated_at: string;
}

export interface AcquirerAlias {
  id: UUID;
  tenant_id: UUID;
  raw: string;
  display_name?: string;
}

export interface LeadExportPreset {
  id: UUID;
  tenant_id: UUID;
  name: string;
  columns: string[];
  created_at: string;
}

export interface LeadImportBatch {
  id: UUID;
  tenant_id: UUID;
  raw_event?: string;
  label?: string;
  source_name?: string;
  row_count: number;
  config?: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
}

/** 経営レビュー(週次幹部MTG支援) — 新規テーブル。既存DBは参照のみ。 */
export interface WeeklyKpiTarget {
  id: UUID;
  tenant_id: UUID;
  target_month: string;
  target_week: number;
  department: string;
  kpi_type: string;
  monthly_target: number;
  weekly_target: number;
  owner_user_id?: UUID;
  created_at: string;
  updated_at: string;
}
export interface WeeklyKpiResult {
  id: UUID;
  tenant_id: UUID;
  target_id: UUID;
  actual_value: number;
  actual_source: "auto" | "manual";
  source_memo?: string;
  input_user_id?: UUID;
  updated_at: string;
}
export interface WeeklyReview {
  id: UUID;
  tenant_id: UUID;
  target_id?: UUID;
  result_id?: UUID;
  evaluation?: string;
  system_comment?: string;
  human_comment?: string;
  root_cause?: string;
  countermeasure?: string;
  owner_user_id?: UUID;
  due_date?: string;
  status: string;
  next_check_point?: string;
  result_comment?: string;
  created_at: string;
  updated_at: string;
}
export interface MtgAction {
  id: UUID;
  tenant_id: UUID;
  meeting_date?: string;
  title: string;
  description?: string;
  department?: string;
  related_type?: string;
  related_id?: UUID;
  owner_user_id?: UUID;
  due_date?: string;
  priority: string;
  status: string;
  completion_comment?: string;
  created_at: string;
  updated_at: string;
}
export interface OpportunityReviewExtension {
  id: UUID;
  tenant_id: UUID;
  existing_opportunity_id: UUID;
  review_week?: string;
  read_up_plan?: string;
  closing_plan?: string;
  blocking_issue?: string;
  executive_comment?: string;
  next_check_point?: string;
  updated_at: string;
}

export interface CampaignReviewExtension {
  id: UUID;
  tenant_id: UUID;
  campaign_id: UUID;
  review_week?: string;
  prep_status: string;
  review_comment?: string;
  next_improvement?: string;
  updated_at: string;
}
export interface DeliveryReview {
  id: UUID;
  tenant_id: UUID;
  customer_id?: UUID;
  project_name?: string;
  delivery_type: string;
  execution_date?: string;
  instructor_user_id?: UUID;
  participants_count?: number;
  satisfaction_score?: number;
  issue_flag: boolean;
  issue_detail?: string;
  countermeasure?: string;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface ProjectProfitReview {
  id: UUID;
  tenant_id: UUID;
  customer_id?: UUID;
  project_type: string;
  project_name?: string;
  contract_amount: number;
  planned_cost: number;
  actual_cost: number;
  forecast_cost: number;
  planned_gross_profit?: number;
  forecast_gross_profit?: number;
  quality_risk?: string;
  cost_risk?: string;
  continuation_status?: string;
  satisfaction_status?: string;
  countermeasure?: string;
  created_at: string;
  updated_at: string;
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
  /** 初回商談日(初回営業日)。カレンダーのアポ予定日(終日)に使用。 */
  first_meeting_date?: string;
  /** アポの日時(時刻あり)。設定時はカレンダーで時刻表示。 */
  appointment_at?: string;
  /** 実施済み商談(meetings)の件数。カレンダーで「初回/N回目」表示に使用。 */
  meeting_count?: number;
  /** 直近の商談日(meetingsの最大日付)。案件一覧のソート・表示に使用。 */
  last_meeting_date?: string;
  /** アポ獲得担当者(インサイドセールス)。 */
  appt_acquired_by?: UUID;
  /** アポ獲得日。 */
  appt_acquired_on?: string;
  amount: number;
  gross_profit?: number;
  gross_profit_rate?: number;
  probability: number;
  /** 担当者の受注予測確率(0-100)。ヨミ・ステージ由来のprobabilityとは別。 */
  rep_probability?: number;
  /** サブスク継続を見込む終了月(YYYY-MM-01)。契約満了の翌月〜この月を更新見込みとして計上。 */
  renewal_until_month?: string;
  /** サブスク更新(継続)確度 0-100。 */
  renewal_probability?: number;
  expected_close_date?: string;
  expected_revenue_month?: string;
  category?: OpportunityCategory;
  /** 案件予測(buyer-journeyフェーズ): info_gathering/comparison/detailed_review/proposal/estimate/future */
  deal_phase?: string;
  /** 事前リサーチ情報(将来AI自動、当初は手入力)。 */
  pre_research?: string;
  /** 事前営業戦略(リサーチを踏まえた仮説トーク方針)。 */
  sales_strategy?: string;
  primary_product_id?: UUID;
  lead_source_id?: UUID;
  /** 流入の詳細(どの展示会・セミナー・施策から入ったか)。取込時のアポソース詳細を保持。 */
  source_detail?: string;
  campaign_id?: UUID;
  campaign_estimated?: boolean;
  next_action_date?: string;
  next_action_text?: string;
  last_activity_at?: string;
  status: OpportunityStatus;
  /** 提案書が必要な案件か(既定false=提案書なしで成約を狙う) */
  proposal_required?: boolean;
  /** 提案書の進捗(not_started/drafting/submitted/revising) */
  proposal_status?: string;
  /** 提案書の提出期限 */
  proposal_due_date?: string;
  lost_reason?: string;
  /** 失注理由コード(C-4: price/timing/competitor/needs_mismatch/budget_freeze/no_response/internal/other) */
  lost_reason_code?: string;
  /** 負けた競合名(競合起因のとき) */
  lost_competitor?: string;
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
  /** Asana型: 上位プロジェクト（任意）。 */
  project_id?: UUID;
  /** Asana型: プロジェクト内セクション（ボード列/リスト見出し）。 */
  section_id?: UUID;
  /** 手動並び替え用の並び順（小さいほど上）。 */
  sort_order?: number;
  /** 着手予定日（任意）。 */
  start_date?: string;
  /** 自由ラベル（タグ）。ボードのグルーピング軸に使える。 */
  labels?: string[];
  /** カード色（COLOR_KEYS のキー）。未設定は既定色。 */
  color?: string | null;
}

/** プロジェクト参照権限（割当メンバー）。管理者のみ割当可能。 */
export interface TaskProjectMember {
  id: UUID;
  tenant_id: UUID;
  project_id: UUID;
  user_id: UUID;
  added_by?: UUID;
  created_at?: string;
}

/** タスクビューの表示形式。 */
export type TaskViewKind = "list" | "board" | "calendar";
/** UIカラーキー（プロジェクト/ポートフォリオの識別色）。 */
export type ColorKey = "teal" | "orange" | "violet" | "rose" | "amber" | "sky" | "lime" | "slate";
/** ゴールの進捗ステータス。 */
export type GoalStatus = "on_track" | "at_risk" | "off_track" | "achieved" | "no_status";

/** ポートフォリオ（複数プロジェクトの束ね）。 */
export interface TaskPortfolio {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string;
  color: ColorKey;
  owner_user_id?: UUID;
  status: "active" | "archived";
  sort_order?: number;
  created_by?: UUID;
  created_at?: string;
}

/** プロジェクト（タスクの上位）。 */
export interface TaskProject {
  id: UUID;
  tenant_id: UUID;
  portfolio_id?: UUID;
  name: string;
  description?: string;
  color: ColorKey;
  icon?: string;
  owner_user_id?: UUID;
  status: "active" | "archived";
  start_date?: string;
  due_date?: string;
  default_view: TaskViewKind;
  sort_order?: number;
  created_by?: UUID;
  created_at?: string;
}

/** プロジェクト内セクション（ボードの列 / リストの見出し）。 */
export interface TaskSection {
  id: UUID;
  tenant_id: UUID;
  project_id: UUID;
  name: string;
  sort_order?: number;
}

/** ゴール（数値目標＋進捗）。 */
export interface Goal {
  id: UUID;
  tenant_id: UUID;
  parent_goal_id?: UUID;
  portfolio_id?: UUID;
  project_id?: UUID;
  name: string;
  description?: string;
  owner_user_id?: UUID;
  metric_kind: "number" | "percent" | "currency";
  target_value?: number;
  current_value: number;
  unit?: string;
  status: GoalStatus;
  period_start?: string;
  period_end?: string;
  sort_order?: number;
  created_by?: UUID;
  created_at?: string;
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
  /** 議事・要点(短い要約)。 */
  summary?: string;
  /** 議事録詳細(全文・文字起こし。AI要約の入力元)。 */
  minutes_detail?: string;
  /** minutes_detail からAI生成した要約(D-4)。 */
  ai_summary?: string;
  ai_summary_at?: string;
  pre_info?: string;
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
