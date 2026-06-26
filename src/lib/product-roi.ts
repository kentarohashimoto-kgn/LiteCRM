/**
 * プロダクト収益分析のロジック(純粋関数)。
 * 粗利は opportunities.gross_profit を正とし、未入力なら 粗利率(gp_rate)→売上 の順で暫定。
 */
export interface ProductRoiRaw {
  id: string;
  name: string;
  category: string | null;
  is_recurring: boolean;
  product_type: string | null;
  unit_cost: number | null;
  priority: boolean;
  gp_rate: number | null;
  status: string | null;
  deals: number;
  revenue: number;
  gross_profit: number;
  open_deals: number;
  open_amount: number;
}

export type ProductJudge = "good" | "watch" | "bad" | "unrated" | "none";

export interface ProductRoiRow extends ProductRoiRaw {
  profit: number;
  profitBasis: "gross" | "rate" | "revenue";
  margin: number | null;
  judge: ProductJudge;
}

export const PRODUCT_JUDGE_LABEL: Record<ProductJudge, string> = {
  good: "🟢 集中",
  watch: "🟡 改善",
  bad: "🔴 撤退検討",
  unrated: "⚪ 粗利未設定",
  none: "・未販売",
};
export const PRODUCT_JUDGE_COLOR: Record<ProductJudge, string> = {
  good: "bg-teal-light/50 text-teal-deep",
  watch: "bg-amber-100 text-amber-700",
  bad: "bg-rose-100 text-rose-700",
  unrated: "bg-mist-soft text-ink/45",
  none: "bg-mist-soft text-ink/35",
};

export const PRODUCT_TYPES: { key: string; label: string }[] = [
  { key: "training", label: "研修" },
  { key: "b2c", label: "B2C" },
  { key: "subscription", label: "サブスク" },
  { key: "consulting", label: "コンサル" },
  { key: "non_ai", label: "非AI" },
  { key: "oxin", label: "オクシン" },
];

/** 収益性判定(仮): 粗利率と販売有無で集中/改善/撤退。 */
export function deriveProduct(r: ProductRoiRaw): ProductRoiRow {
  let profit: number;
  let basis: "gross" | "rate" | "revenue";
  if (r.gross_profit > 0) { profit = r.gross_profit; basis = "gross"; }
  else if (r.gp_rate != null && r.gp_rate > 0) { profit = r.revenue * r.gp_rate; basis = "rate"; }
  else { profit = r.revenue; basis = "revenue"; }
  const margin = r.revenue > 0 ? profit / r.revenue : null;
  let judge: ProductJudge;
  if (r.revenue <= 0 && r.open_deals === 0) judge = "none";
  else if (basis === "revenue") judge = "unrated"; // 原価/粗利率が無く収益性判定不可
  else if (margin != null && margin >= 0.5) judge = "good";
  else if (margin != null && margin >= 0.3) judge = "watch";
  else judge = "bad";
  return { ...r, profit, profitBasis: basis, margin, judge };
}

export function marginPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
