/**
 * 受注見込み(来期計画)のロジック。
 * 期間に売上を月割りし、確度で加重して月次の売上予測に反映する。会計年度=7月開始。
 */
import { FISCAL_START_MONTH } from "@/lib/fiscal";

export interface RevForecast {
  id: string;
  seq: number | null;
  account_name: string | null;
  product: string | null;
  deal_name: string | null;
  note: string | null;
  period_label: string | null;
  period_start: string | null; // YYYY-MM-01
  period_end: string | null;
  amount: number | null;
  cost: number | null;
  probability: number | null; // 0..1
  expected_order_date: string | null;
  owner: string | null;
  memo: string | null;
  entered_on: string | null;
  source_updated_on: string | null;
  fy_start: number | null;
  status: string;
}

export type Band = "commit" | "best" | "pipeline" | "upside";
export const BAND_LABEL: Record<Band, string> = { commit: "Commit(≥90%)", best: "Best(60-89%)", pipeline: "Pipeline(30-59%)", upside: "Upside(<30%)" };
export const BAND_COLOR: Record<Band, string> = {
  commit: "bg-teal-light/50 text-teal-deep", best: "bg-amber-100 text-amber-700",
  pipeline: "bg-sky-100 text-sky-700", upside: "bg-mist-soft text-ink/50",
};
export function bandOf(p: number | null): Band {
  const v = p ?? 0;
  if (v >= 0.9) return "commit";
  if (v >= 0.6) return "best";
  if (v >= 0.3) return "pipeline";
  return "upside";
}

/** "100.00%" / "50%" / "0.5" → 0..1 */
export function parseProbability(s?: string): number | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  const n = parseFloat(v.replace(/[^\d.]/g, ""));
  if (Number.isNaN(n)) return null;
  return v.includes("%") || n > 1 ? n / 100 : n;
}

/** 月番号(1-12) → 会計年度内の実年。7始まりなので 7-12=fyStart年, 1-6=翌年。 */
function yearOfMonth(m: number, fyStart: number): number {
  return m >= FISCAL_START_MONTH ? fyStart : fyStart + 1;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** "7月～8月" / "7月" / "7月〜3月" → {start,end}(YYYY-MM-01)。fyStart基準。空はnull。 */
export function parsePeriod(label: string | undefined, fyStart: number): { start: string | null; end: string | null } {
  const v = (label ?? "").trim();
  if (!v) return { start: null, end: null };
  const months = Array.from(v.matchAll(/(\d{1,2})\s*月/g)).map((m) => parseInt(m[1], 10)).filter((m) => m >= 1 && m <= 12);
  if (months.length === 0) return { start: null, end: null };
  const m1 = months[0];
  const m2 = months[months.length - 1];
  return {
    start: `${yearOfMonth(m1, fyStart)}-${pad(m1)}-01`,
    end: `${yearOfMonth(m2, fyStart)}-${pad(m2)}-01`,
  };
}

/** "¥8,680,000" / "8680000" → number */
export function parseAmount(s?: string): number | null {
  const v = (s ?? "").replace(/[^\d.-]/g, "");
  return v === "" ? null : Number(v);
}
/** "2025年4月1日"/"2025/04/04"/"6/26" → YYYY-MM-DD(年なしは無視) */
export function parseDateLoose(s?: string): string | null {
  const m = (s ?? "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
}

/** 年度の12ヶ月キー(7月〜翌6月)。 */
export function fyMonthKeys(fyStart: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const y = fyStart + Math.floor((FISCAL_START_MONTH - 1 + i) / 12);
    const m = ((FISCAL_START_MONTH - 1 + i) % 12) + 1;
    out.push(`${y}-${pad(m)}`);
  }
  return out;
}

/** 1行の月割り。期間があれば均等割、無ければ受注予定月、いずれも無ければ「未定」。weighted=amount×確度。 */
export function monthlySpread(r: RevForecast): { month: string | null; amount: number; weighted: number }[] {
  const amt = r.amount ?? 0;
  const p = r.probability ?? 0;
  if (amt === 0) return [];
  if (r.period_start && r.period_end) {
    const s = new Date(r.period_start), e = new Date(r.period_end);
    const months: string[] = [];
    const cur = new Date(s.getFullYear(), s.getMonth(), 1);
    while (cur <= e && months.length < 36) {
      months.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    const per = amt / months.length;
    return months.map((month) => ({ month, amount: per, weighted: per * p }));
  }
  const single = r.expected_order_date ? r.expected_order_date.slice(0, 7) : null;
  return [{ month: single, amount: amt, weighted: amt * p }];
}
