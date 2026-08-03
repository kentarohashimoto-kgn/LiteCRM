import { estimateCostUsd } from "./models";

/**
 * 利用実績の集計。
 *
 * ai_lab_usage_daily は「日 × 会社 × 利用者 × モデル」の粒度なので、
 * 管理画面で見たい単位(月・会社・モデル)へ畳む処理をここに集約する。
 * DBアクセスを持たない純関数なので、集計の取り違えはテストで固定できる。
 */

export interface UsageDailyRow {
  date: string; // YYYY-MM-DD
  company_id?: string;
  model_key: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  images: number;
  usd: number;
  /** 単価不明の利用が含まれていない(＝概算が実額を下回っていない)なら true。 */
  costComplete: boolean;
}

export const EMPTY_TOTALS: UsageTotals = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  images: 0,
  usd: 0,
  costComplete: true,
};

/** "2026-08-03" → "2026-08"。想定外の値は空文字にして集計から落とす。 */
export function monthKey(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date ?? "");
  return m ? `${m[1]}-${m[2]}` : "";
}

/** "2026-08" → "2026年8月"。 */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? "");
  return m ? `${m[1]}年${Number(m[2])}月` : key;
}

/** 直近 count か月分のキーを古い順に返す(当月を含む)。 */
export function recentMonths(count: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** 月キーの初日・末日(YYYY-MM-DD)。DBの範囲検索に使う。 */
export function monthBounds(key: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return { from: key, to: key };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}` };
}

export function totalsFor(rows: UsageDailyRow[]): UsageTotals {
  const cost = estimateCostUsd(rows);
  const sum = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + Number(r.requests ?? 0),
      inputTokens: acc.inputTokens + Number(r.input_tokens ?? 0),
      outputTokens: acc.outputTokens + Number(r.output_tokens ?? 0),
      images: acc.images + Number(r.images ?? 0),
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, images: 0 },
  );
  return {
    ...sum,
    totalTokens: sum.inputTokens + sum.outputTokens,
    usd: cost.usd,
    costComplete: cost.complete,
  };
}

export interface MonthlyPoint extends UsageTotals {
  month: string;
  label: string;
}

/**
 * 月別の推移。months で渡した月は利用が無くてもゼロ行として残す
 * (グラフの横軸が歯抜けにならないようにするため)。
 */
export function byMonth(rows: UsageDailyRow[], months: string[]): MonthlyPoint[] {
  const buckets = new Map<string, UsageDailyRow[]>();
  for (const key of months) buckets.set(key, []);
  for (const r of rows) {
    const key = monthKey(r.date);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
  }
  return months.map((month) => ({
    month,
    label: monthLabel(month),
    ...totalsFor(buckets.get(month) ?? []),
  }));
}

/** 会社 × 月のマトリクス。会社横断の月別レポートに使う。 */
export function byCompanyMonth(
  rows: UsageDailyRow[],
  months: string[],
  companyIds: string[],
): Record<string, Record<string, UsageTotals>> {
  const grouped = new Map<string, UsageDailyRow[]>();
  for (const r of rows) {
    const key = `${r.company_id ?? ""}::${monthKey(r.date)}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(r);
    else grouped.set(key, [r]);
  }

  const out: Record<string, Record<string, UsageTotals>> = {};
  for (const companyId of companyIds) {
    out[companyId] = {};
    for (const month of months) {
      out[companyId][month] = totalsFor(grouped.get(`${companyId}::${month}`) ?? []);
    }
  }
  return out;
}

/** モデル別の内訳(多い順)。 */
export function byModel(rows: UsageDailyRow[]): { modelKey: string; totals: UsageTotals }[] {
  const grouped = new Map<string, UsageDailyRow[]>();
  for (const r of rows) {
    const bucket = grouped.get(r.model_key);
    if (bucket) bucket.push(r);
    else grouped.set(r.model_key, [r]);
  }
  return Array.from(grouped.entries())
    .map(([modelKey, list]) => ({ modelKey, totals: totalsFor(list) }))
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
}

/** 前月比(増減率)。前月が0なら比較できないので null。 */
export function momChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

/** 概算コストの表示。USD想定なので小数2桁で丸める。 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
