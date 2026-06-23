/**
 * 展示会選定の自動スコアリング(マーケ入力→優先度/ランク)。
 * 想定リード規模・テーマ相性・費用対効果(ROI)・リード単価(CPL)・セミナー・集客規模・
 * 前後展示会との日程の詰まり を加味。しきい値・配点は調整可能。
 */
import type { ExhibitionCandidate } from "@/lib/types";

export const EXH_STATUS: { key: string; label: string; color: string }[] = [
  { key: "considering", label: "検討中", color: "bg-amber-50 text-amber-700" },
  { key: "apply_planned", label: "申込予定", color: "bg-sky-100 text-sky-700" },
  { key: "applied", label: "申込済", color: "bg-teal-light text-teal-deep" },
  { key: "done", label: "実施済", color: "bg-mist-soft text-ink/50" },
  { key: "skip", label: "見送り", color: "bg-rose-50 text-rose-500" },
];
export const EXH_STATUS_LABEL: Record<string, string> = Object.fromEntries(EXH_STATUS.map((s) => [s.key, s.label]));

export const EXH_DECISION: { key: string; label: string; color: string }[] = [
  { key: "pending", label: "未決", color: "bg-mist-soft text-ink/50" },
  { key: "approved", label: "出展承認", color: "bg-teal-light text-teal-deep" },
  { key: "hold", label: "保留", color: "bg-amber-100 text-amber-700" },
  { key: "rejected", label: "見送り", color: "bg-rose-100 text-rose-600" },
];
export const EXH_DECISION_LABEL: Record<string, string> = Object.fromEntries(EXH_DECISION.map((d) => [d.key, d.label]));

export const THEME_FIT: { key: string; label: string }[] = [
  { key: "high", label: "高" }, { key: "mid", label: "中" }, { key: "low", label: "低" },
];

export const EXH_RANK_COLOR: Record<string, string> = {
  S: "bg-rose-100 text-rose-600", A: "bg-teal-light text-teal-deep", B: "bg-amber-100 text-amber-700",
  C: "bg-mist-soft text-ink/60", D: "bg-mist-soft text-ink/35",
};

export interface ExhScore {
  total: number;
  rank: "S" | "A" | "B" | "C" | "D";
  cost: number;          // 合計費用
  cpl: number | null;    // リード単価
  roi: number | null;    // 想定売上 / 合計費用
  tightDays: number | null; // 直近の他展示会との間隔(日)
  reasons: string[];     // 加点/減点の説明
}

export function totalCost(c: ExhibitionCandidate): number {
  return (c.booth_cost ?? 0) + (c.staff_cost ?? 0) + (c.other_cost ?? 0);
}
/** 想定売上(未入力なら 想定成約×単価 から補完)。 */
export function expectedRevenueOf(c: ExhibitionCandidate): number {
  if (c.expected_revenue != null && c.expected_revenue > 0) return c.expected_revenue;
  if (c.expected_deals != null && c.expected_unit_price != null) return c.expected_deals * c.expected_unit_price;
  return 0;
}

/**
 * 候補のスコアを算出。tightDays は呼び出し側で「他候補との最小日数差」を渡す。
 */
export function scoreExhibition(c: ExhibitionCandidate, tightDays: number | null): ExhScore {
  const reasons: string[] = [];
  const cost = totalCost(c);
  const leads = c.expected_leads ?? 0;
  const revenue = expectedRevenueOf(c);
  const cpl = leads > 0 ? cost / leads : null;
  const roi = cost > 0 ? revenue / cost : null;
  let total = 0;

  // 想定リード規模(最大30)
  const leadPt = leads >= 500 ? 30 : leads >= 300 ? 23 : leads >= 150 ? 15 : leads >= 50 ? 8 : leads > 0 ? 3 : 0;
  total += leadPt;
  if (leadPt >= 23) reasons.push("想定リードが大きい");

  // テーマ相性(最大20)
  const fitPt = c.theme_fit === "high" ? 20 : c.theme_fit === "mid" ? 10 : 0;
  total += fitPt;
  if (c.theme_fit === "high") reasons.push("テーマ相性が高い");
  if (c.theme_fit === "low") reasons.push("テーマ相性が低い");

  // ROI(最大20)
  if (roi != null) {
    const roiPt = roi >= 3 ? 20 : roi >= 2 ? 14 : roi >= 1.5 ? 9 : roi >= 1 ? 4 : 0;
    total += roiPt;
    if (roi >= 2) reasons.push("ROIが高い");
    if (roi < 1) reasons.push("ROIが1未満");
  }

  // CPL(最大15・低いほど良い)
  if (cpl != null) {
    const cplPt = cpl <= 1000 ? 15 : cpl <= 2000 ? 10 : cpl <= 3500 ? 5 : 0;
    total += cplPt;
    if (cpl <= 1500) reasons.push("リード単価が安い");
    if (cpl > 5000) reasons.push("リード単価が高い");
  }

  // セミナー(8)
  if (c.has_seminar) { total += 8; reasons.push("セミナー枠あり"); }

  // 集客規模(最大7)
  const v = c.expected_visitors ?? 0;
  total += v >= 20000 ? 7 : v >= 5000 ? 4 : v > 0 ? 2 : 0;

  // 日程の詰まり(減点)
  if (tightDays != null) {
    if (tightDays <= 7) { total -= 10; reasons.push(`前後の展示会と${tightDays}日差(日程過密)`); }
    else if (tightDays <= 14) { total -= 5; reasons.push(`前後の展示会と${tightDays}日差(やや過密)`); }
  }

  total = Math.max(0, Math.round(total));
  const rank: ExhScore["rank"] = total >= 70 ? "S" : total >= 55 ? "A" : total >= 40 ? "B" : total >= 25 ? "C" : "D";
  return { total, rank, cost, cpl, roi, tightDays, reasons };
}
