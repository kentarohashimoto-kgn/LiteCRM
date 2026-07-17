/**
 * F-202 繰り返しタスクのルールと次回日付計算。
 * 生成方式はAsana方式（完了時に次回タスクを1件生成し、ルールは次回へ引き継ぐ）。
 * 「数字が狂うと信頼を失う」計算のため純関数で実装し、回帰テストを必須とする。
 */

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: RecurrenceFreq;
  /** 間隔（n日/n週/nヶ月/n年ごと）。既定1。 */
  interval?: number;
  /** daily: 平日のみ（土日をスキップ）。 */
  weekdaysOnly?: boolean;
  /** weekly: 曜日（0=日..6=土）。未指定は基準日の曜日。 */
  weekdays?: number[];
  /** monthly: "day"=d日 / "nth"=第n X曜日 / "last"=月末。既定 "day"。 */
  monthlyMode?: "day" | "nth" | "last";
  /** monthly(day): 日（1-31。月の日数を超える場合は月末に丸める）。 */
  monthDay?: number;
  /** monthly(nth): 第n（1-5。その月に第nが無い場合は最後の該当曜日）。 */
  nth?: number;
  /** monthly(nth): 曜日（0=日..6=土）。 */
  nthWeekday?: number;
  /** 終了条件。未指定は無期限。 */
  ends?: { kind: "none" } | { kind: "on_date"; date: string } | { kind: "count"; value: number; done?: number };
}

/* ---------- 日付ユーティリティ（"YYYY-MM-DD" ローカル基準） ---------- */
function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDaysIso(d: string, n: number): string {
  const x = parse(d);
  x.setDate(x.getDate() + n);
  return iso(x);
}
export function diffDaysIso(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}
function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}
/** 週の起点（月曜）。週間隔の判定に使う。 */
function weekStart(d: Date): Date {
  const x = new Date(d);
  const shift = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - shift);
  return x;
}

/** その月の「第n X曜日」。第nが無い月は最後の該当曜日に丸める。 */
function nthWeekdayOfMonth(y: number, m0: number, nth: number, weekday: number): number {
  const firstDow = new Date(y, m0, 1).getDay();
  let day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
  const dim = daysInMonth(y, m0);
  while (day > dim) day -= 7;
  return day;
}

/** date がルールにマッチするか（anchor = 間隔の基準日）。 */
function matches(rule: Recurrence, date: Date, anchor: Date): boolean {
  const interval = Math.max(1, rule.interval ?? 1);
  const dow = date.getDay();
  switch (rule.freq) {
    case "daily": {
      if (rule.weekdaysOnly && (dow === 0 || dow === 6)) return false;
      if (rule.weekdaysOnly) return true; // 平日のみは間隔より曜日を優先（毎営業日）
      return diffDaysIso(iso(anchor), iso(date)) % interval === 0;
    }
    case "weekly": {
      const wds = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [anchor.getDay()];
      if (!wds.includes(dow)) return false;
      const weeks = Math.round(diffDaysIso(iso(weekStart(anchor)), iso(weekStart(date))) / 7);
      return ((weeks % interval) + interval) % interval === 0;
    }
    case "monthly": {
      const months = (date.getFullYear() - anchor.getFullYear()) * 12 + (date.getMonth() - anchor.getMonth());
      if (((months % interval) + interval) % interval !== 0) return false;
      const y = date.getFullYear();
      const m0 = date.getMonth();
      const mode = rule.monthlyMode ?? "day";
      if (mode === "last") return date.getDate() === daysInMonth(y, m0);
      if (mode === "nth") {
        const nth = Math.max(1, Math.min(5, rule.nth ?? 1));
        const wd = rule.nthWeekday ?? anchor.getDay();
        return date.getDate() === nthWeekdayOfMonth(y, m0, nth, wd);
      }
      const want = Math.max(1, Math.min(31, rule.monthDay ?? anchor.getDate()));
      return date.getDate() === Math.min(want, daysInMonth(y, m0));
    }
    case "yearly": {
      const years = date.getFullYear() - anchor.getFullYear();
      if (((years % interval) + interval) % interval !== 0) return false;
      const y = date.getFullYear();
      const m0 = anchor.getMonth();
      const want = Math.min(anchor.getDate(), daysInMonth(y, m0));
      return date.getMonth() === m0 && date.getDate() === want;
    }
  }
}

/**
 * 次回の期日を返す。無ければ null（終了条件到達・ルール不成立）。
 *  - 通常完了（today <= due）: due より後の最初のルール日
 *  - 超過完了（today > due）: 今日以降で最初のルール日（過去日タスクを量産しない）
 */
export function nextOccurrence(rule: Recurrence, due: string, today: string): string | null {
  if (rule.ends?.kind === "count" && (rule.ends.done ?? 1) >= rule.ends.value) return null;

  const anchor = parse(due);
  const after = today > due ? addDaysIso(today, -1) : due;

  // 最長5年先まで走査（日次イテレーション。ルールが十分粗くても現実的な回数）
  const HORIZON = 366 * 5;
  for (let i = 1; i <= HORIZON; i++) {
    const cand = addDaysIso(after, i);
    if (rule.ends?.kind === "on_date" && cand > rule.ends.date) return null;
    if (matches(rule, parse(cand), anchor)) return cand;
  }
  return null;
}

/** 次回生成時にルールへ引き継ぐ ends（回数カウントを進める）。 */
export function advanceEnds(rule: Recurrence): Recurrence {
  if (rule.ends?.kind === "count") {
    return { ...rule, ends: { ...rule.ends, done: (rule.ends.done ?? 1) + 1 } };
  }
  return rule;
}

const DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];

/** ルールの日本語要約（例:「毎週 月・木」「毎月 第2火曜」）。 */
export function recurrenceSummary(rule: Recurrence): string {
  const interval = Math.max(1, rule.interval ?? 1);
  const every = (unit: string) => (interval === 1 ? `毎${unit}` : `${interval}${unit === "日" ? "日" : unit === "週" ? "週間" : unit === "月" ? "ヶ月" : "年"}ごと`);
  let base: string;
  switch (rule.freq) {
    case "daily":
      base = rule.weekdaysOnly ? "毎営業日" : every("日");
      break;
    case "weekly": {
      const wds = (rule.weekdays ?? []).slice().sort((a, b) => a - b).map((d) => DOW_JP[d]).join("・");
      base = `${every("週")}${wds ? ` ${wds}` : ""}`;
      break;
    }
    case "monthly": {
      const mode = rule.monthlyMode ?? "day";
      const detail = mode === "last" ? "月末" : mode === "nth" ? `第${rule.nth ?? 1}${DOW_JP[rule.nthWeekday ?? 1]}曜` : `${rule.monthDay ?? 1}日`;
      base = `${every("月")} ${detail}`;
      break;
    }
    case "yearly":
      base = every("年");
      break;
  }
  if (rule.ends?.kind === "on_date") base += `（${rule.ends.date}まで）`;
  if (rule.ends?.kind === "count") base += `（全${rule.ends.value}回）`;
  return base;
}
