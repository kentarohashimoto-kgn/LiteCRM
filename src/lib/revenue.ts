/**
 * 受注額(受注日ベース)と請求額(請求日ベース)の月別集計。
 * 請求スケジュール(billing_schedules)を月単位に展開し、分類別に積み上げる。
 */
import type { BillingSchedule, Opportunity, OpportunityCategory } from "@/lib/types";
import { CATEGORIES } from "@/lib/constants";
import { addMonths, monthKey, startOfMonth } from "@/lib/utils";
import type { StackSeries } from "@/components/charts/stacked-trend-chart";

export interface MonthCatPoint {
  monthKey: string;
  category: OpportunityCategory;
  amount: number;
}

/** 請求スケジュールを月別(分類別)に展開。recurringは開始〜終了月まで毎月計上。 */
export function expandBilling(
  schedules: BillingSchedule[],
  catOf: (oppId: string) => OpportunityCategory | undefined,
): MonthCatPoint[] {
  const out: MonthCatPoint[] = [];
  for (const s of schedules) {
    const category = catOf(s.opportunity_id) ?? "other";
    if (s.kind === "recurring" && s.recurring_start_month) {
      const start = startOfMonth(new Date(s.recurring_start_month));
      const end = s.recurring_end_month ? startOfMonth(new Date(s.recurring_end_month)) : start;
      let m = start;
      let guard = 0;
      while (m.getTime() <= end.getTime() && guard < 240) {
        out.push({ monthKey: monthKey(m), category, amount: s.amount });
        m = addMonths(m, 1);
        guard++;
      }
    } else if (s.billing_date) {
      out.push({ monthKey: monthKey(startOfMonth(new Date(s.billing_date))), category, amount: s.amount });
    }
  }
  return out;
}

/** 受注額を受注日(expected_close_date)で月別(分類別)に計上(受注済みのみ)。 */
export function ordersByMonth(opps: Opportunity[]): MonthCatPoint[] {
  const out: MonthCatPoint[] = [];
  for (const o of opps) {
    if (o.status !== "won" || !o.amount) continue;
    const ref = o.expected_close_date || o.expected_revenue_month;
    if (!ref) continue;
    out.push({
      monthKey: monthKey(startOfMonth(new Date(ref))),
      category: (o.category ?? "other") as OpportunityCategory,
      amount: o.amount,
    });
  }
  return out;
}

export interface MonthCol {
  key: string;
  label: string;
}

/** 与えられた点群の最小〜最大月を埋めた月リストを作る。空ならbase月のみ。 */
export function monthRange(pointSets: MonthCatPoint[][], base: Date = new Date()): MonthCol[] {
  const keys = pointSets.flat().map((p) => p.monthKey);
  if (keys.length === 0) {
    const m = startOfMonth(base);
    return [{ key: monthKey(m), label: `${String(m.getFullYear()).slice(2)}/${m.getMonth() + 1}` }];
  }
  const min = keys.reduce((a, b) => (a < b ? a : b));
  const max = keys.reduce((a, b) => (a > b ? a : b));
  const start = startOfMonth(new Date(min));
  const end = startOfMonth(new Date(max));
  const cols: MonthCol[] = [];
  let m = start;
  let guard = 0;
  while (m.getTime() <= end.getTime() && guard < 240) {
    cols.push({ key: monthKey(m), label: `${String(m.getFullYear()).slice(2)}/${m.getMonth() + 1}` });
    m = addMonths(m, 1);
    guard++;
  }
  return cols;
}

/** 分類別の積み上げデータ(StackedTrendChart用)を作る。 */
export function monthlyStacks(points: MonthCatPoint[], cols: MonthCol[]): {
  data: Record<string, string | number>[];
  series: StackSeries[];
  totalsByCol: number[];
} {
  const idx = new Map(cols.map((c, i) => [c.key, i]));
  const data: Record<string, string | number>[] = cols.map((c) => {
    const row: Record<string, string | number> = { label: c.label };
    for (const cat of CATEGORIES) row[cat.key] = 0;
    return row;
  });
  const totalsByCol = cols.map(() => 0);
  for (const p of points) {
    const i = idx.get(p.monthKey);
    if (i == null) continue;
    data[i][p.category] = (data[i][p.category] as number) + p.amount;
    totalsByCol[i] += p.amount;
  }
  const series: StackSeries[] = CATEGORIES.map((c) => ({ key: c.key, name: c.label, color: c.color }));
  return { data, series, totalsByCol };
}
