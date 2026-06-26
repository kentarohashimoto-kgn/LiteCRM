/**
 * 施策ROI分析のロジック(純粋関数)。
 * channel_roi RPC の生集計から、CAC/ROI/転換率/判定(Good/Watch/Bad)を算出する。
 * しきい値は仮(後調整)。粗利が未入力(0)の施策は「売上ベース」で暫定ROIを出す。
 */

export interface ChannelRoiRaw {
  id: string;
  name: string;
  category: string | null;
  kind: string | null;
  priority: boolean;
  committed_metric: string | null;
  committed_qty: number | null;
  target_level: string | null;
  cost: number;
  result_qty: number;
  leads: number;
  appts: number;
  deals: number;
  revenue: number;
  gross_profit: number;
  open_deals: number;
  open_amount: number;
}

export type RoiJudge = "good" | "watch" | "bad" | "uncosted";

export interface ChannelRoiRow extends ChannelRoiRaw {
  /** ROIの分子(粗利。未入力なら売上で暫定) */
  profit: number;
  profitBasis: "gross" | "revenue";
  roi: number | null; // (profit - cost) / cost
  cac: number | null; // cost / 受注数
  cpl: number | null; // cost / リード
  cpa: number | null; // cost / アポ
  leadToAppt: number | null;
  apptToDeal: number | null;
  judge: RoiJudge;
}

/** ROIしきい値(仮)。tenant_settingsで後から調整可能にする想定。 */
export const ROI_THRESHOLDS = { good: 2.0, watch: 0.5 };

export const JUDGE_LABEL: Record<RoiJudge, string> = {
  good: "🟢 Good(増資)",
  watch: "🟡 Watch(改善)",
  bad: "🔴 Bad(撤退検討)",
  uncosted: "⚪ コスト未入力",
};
export const JUDGE_COLOR: Record<RoiJudge, string> = {
  good: "bg-teal-light/50 text-teal-deep",
  watch: "bg-amber-100 text-amber-700",
  bad: "bg-rose-100 text-rose-700",
  uncosted: "bg-mist-soft text-ink/45",
};

export function deriveRoi(r: ChannelRoiRaw): ChannelRoiRow {
  const profit = r.gross_profit > 0 ? r.gross_profit : r.revenue;
  const profitBasis: "gross" | "revenue" = r.gross_profit > 0 ? "gross" : "revenue";
  const roi = r.cost > 0 ? (profit - r.cost) / r.cost : null;
  const cac = r.deals > 0 && r.cost > 0 ? r.cost / r.deals : null;
  const cpl = r.leads > 0 && r.cost > 0 ? r.cost / r.leads : null;
  const cpa = r.appts > 0 && r.cost > 0 ? r.cost / r.appts : null;
  const leadToAppt = r.leads > 0 ? r.appts / r.leads : null;
  const apptToDeal = r.appts > 0 ? r.deals / r.appts : null;
  let judge: RoiJudge;
  if (r.cost <= 0) judge = "uncosted";
  else if (roi != null && roi >= ROI_THRESHOLDS.good) judge = "good";
  else if (roi != null && roi >= ROI_THRESHOLDS.watch) judge = "watch";
  else judge = "bad";
  return { ...r, profit, profitBasis, roi, cac, cpl, cpa, leadToAppt, apptToDeal, judge };
}

export const CHANNEL_CATEGORIES = [
  "展示会", "代理店", "セミナー", "顧問", "アポ代行", "交流会・イベント",
  "広告", "オーガニック", "紹介", "マッチング", "自社営業", "その他",
];
export const CHANNEL_KINDS: { key: string; label: string }[] = [
  { key: "self", label: "自社" }, { key: "agency", label: "代理店/外注" }, { key: "advisor", label: "顧問" },
  { key: "ad", label: "広告" }, { key: "organic", label: "オーガニック" }, { key: "referral", label: "紹介" },
  { key: "event", label: "イベント" }, { key: "other", label: "その他" },
];
export const COST_MODELS: { key: string; label: string }[] = [
  { key: "none", label: "なし" }, { key: "fixed_monthly", label: "月額固定" },
  { key: "per_result", label: "成果報酬" }, { key: "one_time", label: "単発" },
];
export const TARGET_LEVELS: { key: string; label: string }[] = [
  { key: "enterprise", label: "エンプラ" }, { key: "mid", label: "中堅" }, { key: "smb", label: "SMB" },
];

export function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
export function roiPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
