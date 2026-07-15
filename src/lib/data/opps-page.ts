/** 案件一覧のサーバーページング用の型と変換。 */
import type { OppView } from "@/lib/data/select";

/** RPC opportunities_page が返す1行(会社名・担当名等を埋め込み済み)。 */
export interface LeanOppRow {
  id: string;
  name: string;
  account_name: string | null;
  yomi: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  primary_product_id: string | null;
  product_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_estimated: boolean | null;
  lead_source_id: string | null;
  source_name: string | null;
  source_detail: string | null;
  amount: number;
  stage: string;
  probability: number;
  forecast_category: string;
  status: string;
  deal_phase: string | null;
  expected_close_date: string | null;
  expected_revenue_month: string | null;
  next_action_date: string | null;
  next_action_text: string | null;
  next_action_status: "open" | "done" | null;
  notes: string | null;
  last_activity_at: string | null;
  risk_level: string | null;
  first_meeting_date: string | null;
  appointment_at: string | null;
  meeting_count: number;
  last_meeting_date: string | null;
  created_at: string;
  updated_at: string;
  weighted: number;
}

export interface OppsPage {
  rows: LeanOppRow[];
  total: number;
  sum_amount: number;
  sum_weighted: number;
}

/** RPCの軽量行を、既存コンポーネント互換の OppView へ変換。 */
export function leanToOppView(r: LeanOppRow): OppView {
  return {
    id: r.id,
    name: r.name,
    account_id: "",
    owner_user_id: r.owner_user_id ?? "",
    yomi: r.yomi ?? undefined,
    amount: r.amount,
    stage: r.stage as OppView["stage"],
    probability: r.probability,
    forecast_category: r.forecast_category as OppView["forecast_category"],
    status: r.status as OppView["status"],
    deal_phase: r.deal_phase ?? undefined,
    primary_product_id: r.primary_product_id ?? undefined,
    lead_source_id: r.lead_source_id ?? undefined,
    source_detail: r.source_detail ?? undefined,
    campaign_id: r.campaign_id ?? undefined,
    campaign_estimated: r.campaign_estimated ?? undefined,
    expected_close_date: r.expected_close_date ?? undefined,
    expected_revenue_month: r.expected_revenue_month ?? undefined,
    next_action_date: r.next_action_date ?? undefined,
    next_action_text: r.next_action_text ?? undefined,
    next_action_status: r.next_action_status ?? null,
    notes: r.notes ?? undefined,
    last_activity_at: r.last_activity_at ?? undefined,
    risk_level: (r.risk_level ?? undefined) as OppView["risk_level"],
    first_meeting_date: r.first_meeting_date ?? undefined,
    appointment_at: r.appointment_at ?? undefined,
    meeting_count: r.meeting_count ?? 0,
    last_meeting_date: r.last_meeting_date ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    account: { name: r.account_name ?? "—" } as OppView["account"],
    owner: r.owner_user_id ? ({ id: r.owner_user_id, name: r.owner_name ?? "—", avatarColor: r.owner_color ?? "#008C8C" } as OppView["owner"]) : undefined,
    product: r.primary_product_id ? ({ name: r.product_name ?? "—" } as OppView["product"]) : undefined,
    leadSource: r.lead_source_id ? ({ name: r.source_name ?? "—" } as OppView["leadSource"]) : undefined,
    campaign: r.campaign_id ? ({ name: r.campaign_name ?? "—" } as OppView["campaign"]) : undefined,
    weighted: r.weighted,
  } as OppView;
}
