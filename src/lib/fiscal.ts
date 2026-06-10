/**
 * 年度(会計年度)ユーティリティ。
 * カトルセの決算期は6月 → 会計年度は 7月開始・翌6月終了。
 * 例: 2025年度 = 2025年7月〜2026年6月。
 */
import { monthKey } from "@/lib/utils";

/** 年度開始月(1-indexed)。7月始まり。 */
export const FISCAL_START_MONTH = 7;

/** その日付が属する年度の開始年。 */
export function fiscalStartYear(d: Date): number {
  return d.getMonth() + 1 >= FISCAL_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
}

export function currentFiscalStartYear(now: Date = new Date()): number {
  return fiscalStartYear(now);
}

export function fiscalYearLabel(startYear: number): string {
  return `${startYear}年度`;
}

export interface FiscalMonth {
  key: string; // YYYY-MM-01
  label: string; // "7月" など
  year: number;
  month: number; // 1-12
}

/** 年度(開始年)の12ヶ月(7月〜翌6月)。 */
export function fiscalMonths(startYear: number): FiscalMonth[] {
  const out: FiscalMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new Date(startYear, FISCAL_START_MONTH - 1 + i, 1);
    out.push({ key: monthKey(m), label: `${m.getMonth() + 1}月`, year: m.getFullYear(), month: m.getMonth() + 1 });
  }
  return out;
}

/** monthKey(YYYY-MM-01) がその年度に含まれるか。 */
export function isInFiscalYear(mKey: string, startYear: number): boolean {
  return fiscalMonths(startYear).some((m) => m.key === mKey);
}
