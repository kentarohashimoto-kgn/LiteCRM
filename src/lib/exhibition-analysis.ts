/** 展示会(raw_event単位)の時系列・主催・テーマ分析ロジック(純粋関数)。 */

export interface ExhibitionRow {
  raw_event: string;
  ym: string | null;       // YYYYMM
  label: string | null;
  organizer: string | null;
  theme: string | null;
  cost: number | null;
  leads: number;
  appts: number;
  deals: number;
  revenue: number;
  important: number;          // 重要リード(ランクS/A・大企業・決裁層)
  important_no_appt: number;  // 重要だが未アポ(掘り起こし最優先)
  nurture: number;            // 未アポ・未失注(ナーチャリング母数)
}

export type Trend = "up" | "flat" | "down";

export const TREND_LABEL: Record<Trend, string> = { up: "↗ 右肩上がり", flat: "→ 横ばい", down: "↘ 低下傾向" };
export const TREND_COLOR: Record<Trend, string> = {
  up: "bg-teal-light/50 text-teal-deep",
  flat: "bg-mist-soft text-ink/55",
  down: "bg-rose-100 text-rose-700",
};

/** 時系列(古→新)の値から傾向を判定。線形回帰の傾きを平均で正規化。 */
export function trendOf(values: number[]): Trend {
  const n = values.length;
  if (n < 3) return "flat";
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (values[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const rel = my !== 0 ? slope / my : 0; // 1期あたり平均比の増減
  if (rel > 0.03) return "up";
  if (rel < -0.03) return "down";
  return "flat";
}

export interface GroupAgg {
  key: string;
  count: number;
  leads: number;
  appts: number;
  deals: number;
  revenue: number;
  cost: number;
  important_no_appt: number;
  nurture: number;
  cpl: number | null;
  roi: number | null;
}

/** organizer / theme などのキーで集計。 */
export function groupBy(rows: ExhibitionRow[], pick: (r: ExhibitionRow) => string | null): GroupAgg[] {
  const map = new Map<string, GroupAgg>();
  for (const r of rows) {
    const key = (pick(r) ?? "").trim() || "未設定";
    const g = map.get(key) ?? { key, count: 0, leads: 0, appts: 0, deals: 0, revenue: 0, cost: 0, important_no_appt: 0, nurture: 0, cpl: null, roi: null };
    g.count += 1; g.leads += r.leads; g.appts += r.appts; g.deals += r.deals; g.revenue += r.revenue; g.cost += r.cost ?? 0;
    g.important_no_appt += r.important_no_appt; g.nurture += r.nurture;
    map.set(key, g);
  }
  const out = Array.from(map.values());
  for (const g of out) {
    g.cpl = g.leads > 0 && g.cost > 0 ? g.cost / g.leads : null;
    g.roi = g.cost > 0 ? (g.revenue - g.cost) / g.cost : null;
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
}

/** "202602" → "2026/02"。 */
export function fmtYm(ym: string | null): string {
  if (!ym || ym.length < 6) return ym ?? "—";
  return `${ym.slice(0, 4)}/${ym.slice(4, 6)}`;
}
/** 表示名: "2026/02 AIWorld"。 */
export function exhibitionLabel(r: { ym: string | null; label: string | null; raw_event: string }): string {
  const name = r.label || r.raw_event;
  return r.ym ? `${fmtYm(r.ym)} ${name}` : name;
}
