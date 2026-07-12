/** 稼働報告の日付・時間ヘルパー(クライアント/サーバー共用の純関数)。 */

/** JSTの今日 (YYYY-MM-DD)。 */
export function todayJST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/** dateISO(YYYY-MM-DD)の属する週の月曜(ISO週)。 */
export function weekStartOf(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00Z");
  if (isNaN(d.getTime())) return dateISO;
  const dow = d.getUTCDay(); // 0=日
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(dateISO: string, n: number): string {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 月初(YYYY-MM-01)から月末日(YYYY-MM-DD)。 */
export function monthEndOf(monthStartISO: string): string {
  const d = new Date(monthStartISO + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * 稼働時間入力のパース。"1:30"→1.5 / "1.5"→1.5 / "０：３０"等の全角も許容。
 * 不正・負値は 0。15分単位より細かい値もそのまま保持する。
 */
export function parseHoursInput(v: string): number {
  const s = String(v ?? "")
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[．]/g, ".");
  if (!s) return 0;
  const hm = s.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(s);
  return isFinite(n) && n > 0 ? Math.min(n, 24 * 7) : 0;
}

/** 1.5 → "1:30" 表示(集計値の見やすさ用)。 */
export function formatHoursHM(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  let h = Math.floor(abs);
  let m = Math.round((abs - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

/**
 * 稼働時間→原価額の換算。
 * rate_unit=hourly は 時間×単価、man_month は 時間÷月基準時間×人月単価。
 */
export function hoursToCost(hours: number, costRate: number, rateUnit: string, hoursPerMonth: number): number {
  if (!costRate || !hours) return 0;
  return rateUnit === "hourly" ? hours * costRate : (hours / (hoursPerMonth || 160)) * costRate;
}
