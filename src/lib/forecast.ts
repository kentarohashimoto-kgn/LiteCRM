/**
 * 売上予測ロジック(要件 9.9)。MVPはルールベース。
 *   weighted_amount = amount * probability / 100
 */

import type { OppView } from "@/lib/data/store";
import type { SalesTarget } from "@/lib/types";
import { addMonths, monthKey, startOfMonth, sum } from "@/lib/utils";

export interface ForecastBucket {
  monthKey: string;
  label: string;
  commit: number;
  bestCase: number; // commit + best_case
  pipeline: number;
  upside: number;
  weighted: number;
  target: number;
  gap: number; // commit+bestCase - target
  wonAmount: number;
}

const openStatuses = new Set(["open"]);

/** 受注計上月(expected_revenue_month or expected_close_date)で判定 */
function revenueMonthKey(o: OppView): string | null {
  const ref = o.expected_revenue_month || o.expected_close_date;
  if (!ref) return null;
  return monthKey(startOfMonth(new Date(ref)));
}

export function buildForecast(
  opps: OppView[],
  targets: SalesTarget[],
  months = 6,
  base: Date = new Date(),
): ForecastBucket[] {
  const targetMap = new Map(targets.map((t) => [t.target_month, t.target_amount]));
  const buckets: ForecastBucket[] = [];

  for (let i = 0; i < months; i++) {
    const m = addMonths(startOfMonth(base), i);
    const key = monthKey(m);
    const inMonth = opps.filter((o) => revenueMonthKey(o) === key);
    const open = inMonth.filter((o) => openStatuses.has(o.status));

    const commit = sum(open.filter((o) => o.forecast_category === "commit"), (o) => o.amount);
    const best = sum(open.filter((o) => o.forecast_category === "best_case"), (o) => o.amount);
    const pipeline = sum(open.filter((o) => o.forecast_category === "pipeline"), (o) => o.amount);
    const upside = sum(open.filter((o) => o.forecast_category === "upside"), (o) => o.amount);
    const weighted = sum(open, (o) => o.weighted);
    const won = sum(inMonth.filter((o) => o.status === "won"), (o) => o.amount);
    const target = targetMap.get(key) ?? 0;
    const bestCaseTotal = commit + best + won;

    buckets.push({
      monthKey: key,
      label: `${m.getMonth() + 1}月`,
      commit: commit + won,
      bestCase: bestCaseTotal,
      pipeline,
      upside,
      weighted: weighted + won,
      target,
      gap: bestCaseTotal - target,
      wonAmount: won,
    });
  }
  return buckets;
}

export interface PeriodSummary {
  label: string;
  commit: number;
  bestCase: number;
  pipeline: number;
  weighted: number;
  target: number;
  gap: number;
}

export function summarizePeriod(buckets: ForecastBucket[], from: number, to: number, label: string): PeriodSummary {
  const slice = buckets.slice(from, to);
  return {
    label,
    commit: sum(slice, (b) => b.commit),
    bestCase: sum(slice, (b) => b.bestCase),
    pipeline: sum(slice, (b) => b.pipeline),
    weighted: sum(slice, (b) => b.weighted),
    target: sum(slice, (b) => b.target),
    gap: sum(slice, (b) => b.gap),
  };
}
