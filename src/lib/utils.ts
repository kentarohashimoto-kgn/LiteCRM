import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 通貨表記。デザインガイド「数字は大きく、単位は小さく」を意識し、万円/円を切替表示。 */
export function formatYen(value: number | null | undefined): string {
  if (value == null) return "—";
  return "¥" + Math.round(value).toLocaleString("ja-JP");
}

/** 大きな金額を「万円」単位で表示(ダッシュボードの強調数値向け) */
export function formatManYen(value: number | null | undefined): {
  value: string;
  unit: string;
} {
  if (value == null) return { value: "—", unit: "" };
  const man = value / 10000;
  if (Math.abs(man) >= 10000) {
    return { value: (man / 10000).toFixed(1), unit: "億円" };
  }
  return { value: Math.round(man).toLocaleString("ja-JP"), unit: "万円" };
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return (value * 100).toFixed(digits) + "%";
}

/**
 * 日時をJST(UTC+9)の年月日時分秒に分解する。
 *
 * 実行環境のタイムゾーンに依存しないことが要件。サーバー(Vercel)はUTCで動くため、
 * getFullYear() 等のローカル時刻ゲッターをそのまま使うとUTCのまま表示され、
 * JSTの0:00〜9:00は日付まで1日ずれる。日本はサマータイムが無いので固定+9hでよい。
 */
function jstParts(d: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return { y: j.getUTCFullYear(), mo: j.getUTCMonth() + 1, d: j.getUTCDate(), h: j.getUTCHours(), mi: j.getUTCMinutes(), s: j.getUTCSeconds() };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** JSTの「M/D」。 */
export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const j = jstParts(d);
  return `${j.mo}/${j.d}`;
}

/** JSTの「YYYY/M/D」。 */
export function formatDateFull(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const j = jstParts(d);
  return `${j.y}/${j.mo}/${j.d}`;
}

/** ISO日時をJSTの「YYYY/M/D HH:MM」で表示(受付日時など)。 */
export function formatDateTimeJst(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const j = jstParts(d);
  return `${j.y}/${j.mo}/${j.d} ${pad2(j.h)}:${pad2(j.mi)}`;
}

/** ISO日時をJSTの「YYYY/M/D HH:MM:SS」で表示(送信履歴など、秒まで要る場面)。 */
export function formatDateTimeSecJst(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const j = jstParts(d);
  return `${j.y}/${j.mo}/${j.d} ${pad2(j.h)}:${pad2(j.mi)}:${pad2(j.s)}`;
}

/**
 * リードの獲得日時。QRスキャン時刻(scanned_at)があれば分単位まで、
 * 無ければ獲得日(acquired_at=日付のみ。名刺取込・手入力)を表示する。
 */
export function formatAcquiredAt(scannedAt?: string | null, acquiredAt?: string | null): string {
  if (scannedAt) return formatDateTimeJst(scannedAt);
  if (acquiredAt) return formatDateFull(acquiredAt);
  return "—";
}

/** ISO日時をJSTの HH:MM で表示。時刻が無ければ空文字。 */
export function formatTimeJst(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const j = jstParts(d);
  return `${pad2(j.h)}:${pad2(j.mi)}`;
}

/** ISO日時をJST基準の YYYY-MM-DD に変換(日付グルーピング用)。 */
export function toJstDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const j = jstParts(d);
  return `${j.y}-${pad2(j.mo)}-${pad2(j.d)}`;
}

export function formatMonth(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const j = jstParts(d);
  return `${j.y}年${j.mo}月`;
}

/** 2つの日付の差(日数)。a - b。 */
export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function daysSince(value?: string | null, now: Date = new Date()): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return daysBetween(now, d);
}

/** YYYY-MM-01 形式の月キー。startOfMonth/addMonths と対で使う(同じローカル基準)。 */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** 同じ月か(JST基準)。実行環境のTZに依存しない。 */
export function sameMonth(value: string | undefined | null, ref: Date): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const a = jstParts(d);
  const b = jstParts(ref);
  return a.y === b.y && a.mo === b.mo;
}

export function sum<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((acc, i) => acc + (fn(i) || 0), 0);
}

export function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = keyFn(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

export function initials(name: string): string {
  return name.trim().slice(0, 2);
}
