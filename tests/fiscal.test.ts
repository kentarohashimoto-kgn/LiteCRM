/**
 * E-5 回帰テスト: 会計年度(7月開始・翌6月終了)のユーティリティ。
 */
import { describe, expect, it } from "vitest";
import { fiscalStartYear, fiscalMonths, isInFiscalYear } from "@/lib/fiscal";

describe("fiscalStartYear", () => {
  it("7月以降はその年が年度開始年", () => {
    expect(fiscalStartYear(new Date(2026, 6, 1))).toBe(2026); // 2026-07
    expect(fiscalStartYear(new Date(2026, 11, 31))).toBe(2026); // 2026-12
  });
  it("6月以前は前年が年度開始年", () => {
    expect(fiscalStartYear(new Date(2026, 5, 30))).toBe(2025); // 2026-06
    expect(fiscalStartYear(new Date(2026, 0, 1))).toBe(2025); // 2026-01
  });
});

describe("fiscalMonths", () => {
  it("7月から翌6月までの12ヶ月を返す", () => {
    const months = fiscalMonths(2025);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ key: "2025-07-01", label: "7月", year: 2025, month: 7 });
    expect(months[11]).toMatchObject({ key: "2026-06-01", label: "6月", year: 2026, month: 6 });
  });
});

describe("isInFiscalYear", () => {
  it("年度内/年度外を正しく判定", () => {
    expect(isInFiscalYear("2025-07-01", 2025)).toBe(true);
    expect(isInFiscalYear("2026-06-01", 2025)).toBe(true);
    expect(isInFiscalYear("2026-07-01", 2025)).toBe(false);
    expect(isInFiscalYear("2025-06-01", 2025)).toBe(false);
  });
});
