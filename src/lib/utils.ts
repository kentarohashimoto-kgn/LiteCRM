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

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateFull(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatMonth(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
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

/** YYYY-MM-01 形式の月キー */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function sameMonth(value: string | undefined | null, ref: Date): boolean {
  if (!value) return false;
  const d = new Date(value);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
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
