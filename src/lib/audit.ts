/**
 * B-1 変更履歴: audit_logs の表示用ヘルパー。
 * DBトリガー(fn_audit_row)が UPDATE の差分(変更された項目のみ)を before/after に保存している。
 */
import { STAGE_MAP, FORECAST_MAP, DEAL_PHASE_MAP } from "@/lib/constants";

export interface AuditLog {
  id: string;
  actor_user_id: string | null;
  table_name: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

/** 表示するフィールドの日本語ラベル(未定義キーはそのまま表示)。 */
const FIELD_LABELS: Record<string, string> = {
  // 共通
  name: "名称",
  notes: "メモ",
  owner_user_id: "担当",
  status: "ステータス",
  deleted_at: "削除",
  deleted_by: "削除者",
  // 案件
  stage: "ステージ",
  yomi: "ヨミ",
  amount: "金額",
  gross_profit: "粗利",
  probability: "確度",
  forecast_category: "予測区分",
  expected_close_date: "受注予定日",
  expected_revenue_month: "計上月",
  next_action_date: "次回AC日",
  next_action_text: "次回AC内容",
  appointment_at: "アポ日時",
  first_meeting_date: "初回商談日",
  deal_phase: "検討フェーズ",
  lost_reason: "失注理由",
  reapproach_date: "再アプローチ日",
  budget_status: "予算状況",
  proposal_doc_url: "提案書URL",
  proposed_solution: "提案ソリューション",
  primary_product_id: "商材",
  campaign_id: "施策",
  lead_source_id: "流入経路",
  account_id: "顧客",
  source_detail: "獲得経路詳細",
  risk_level: "リスク",
  pre_research: "事前リサーチ",
  sales_strategy: "営業戦略",
  // 顧客
  industry: "業種",
  area: "エリア",
  rank: "ランク",
  focus: "注力度",
  employee_size: "従業員規模",
  website: "Webサイト",
  next_contact_date: "次回接触日",
  // リード
  company_name: "会社名",
  contact_name: "氏名",
  email: "メール",
  phone: "電話",
  mobile_phone: "携帯",
  job_title: "役職",
  disposition: "対応状況",
  funnel_stage: "ファネル",
  raw_event: "獲得イベント",
  role_level: "役職レベル",
  needs: "課題感",
  timing: "導入時期",
  budget_band: "予算",
};

const VALUE_MAPS: Record<string, Record<string, string>> = {
  stage: Object.fromEntries(Object.entries(STAGE_MAP).map(([k, v]) => [k, (v as { label: string }).label])),
  forecast_category: Object.fromEntries(Object.entries(FORECAST_MAP).map(([k, v]) => [k, (v as { label: string }).label])),
  deal_phase: DEAL_PHASE_MAP as Record<string, string>,
  status: { open: "商談中", won: "受注", lost: "失注", prospect: "見込み", customer: "顧客", inactive: "休眠", new: "新規", qualified: "有効", disqualified: "対象外" },
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** 監査ログの値を人が読める文字列に。 */
export function formatAuditValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  const mapped = VALUE_MAPS[key]?.[String(value)];
  if (mapped) return mapped;
  if (typeof value === "number") return value.toLocaleString("ja-JP");
  const s = String(value);
  // ISO日時は日付+時刻に短縮
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

export interface AuditChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

/** UPDATEログを項目ごとの変更リストに展開。uuid系の生値は要約する。 */
export function auditChanges(log: AuditLog): AuditChange[] {
  const keys = new Set<string>([
    ...Object.keys(log.before_data ?? {}),
    ...Object.keys(log.after_data ?? {}),
  ]);
  keys.delete("deleted_by"); // deleted_at と重複表示になるため
  return Array.from(keys).map((key) => ({
    key,
    label: fieldLabel(key),
    before: formatAuditValue(key, log.before_data?.[key]),
    after: formatAuditValue(key, log.after_data?.[key]),
  }));
}

/** ログ1件の種別を判定(削除/復元は deleted_at の変化で表現される)。 */
export function auditKind(log: AuditLog): "created" | "deleted" | "restored" | "updated" | "purged" {
  if (log.action === "INSERT") return "created";
  if (log.action === "DELETE") return "purged";
  const before = log.before_data?.deleted_at ?? null;
  const after = log.after_data?.deleted_at ?? null;
  if (!before && after) return "deleted";
  if (before && !after) return "restored";
  return "updated";
}
