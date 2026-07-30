/**
 * E-5 回帰テスト: 金額表示・日付ユーティリティ。
 */
import { describe, expect, it } from "vitest";
import { formatYen, formatManYen, formatPercent, monthKey, daysSince, sameMonth, sum, formatAcquiredAt } from "@/lib/utils";

describe("formatYen / formatManYen / formatPercent", () => {
  it("円表記", () => {
    expect(formatYen(1234567)).toBe("¥1,234,567");
    expect(formatYen(null)).toBe("—");
  });
  it("万円/億円の切替", () => {
    expect(formatManYen(12_340_000)).toEqual({ value: "1,234", unit: "万円" });
    expect(formatManYen(250_000_000)).toEqual({ value: "2.5", unit: "億円" });
    expect(formatManYen(null)).toEqual({ value: "—", unit: "" });
  });
  it("百分率", () => {
    expect(formatPercent(0.325, 1)).toBe("32.5%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("日付ユーティリティ", () => {
  it("monthKey は YYYY-MM-01", () => {
    expect(monthKey(new Date(2026, 6, 15))).toBe("2026-07-01");
    expect(monthKey(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
  it("daysSince", () => {
    const now = new Date(2026, 6, 15);
    expect(daysSince("2026-07-08", now)).toBe(7);
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("invalid", now)).toBeNull();
  });
  it("sameMonth", () => {
    const ref = new Date(2026, 6, 15);
    expect(sameMonth("2026-07-01", ref)).toBe(true);
    expect(sameMonth("2026-08-01", ref)).toBe(false);
    expect(sameMonth(null, ref)).toBe(false);
  });
});

describe("sum", () => {
  it("NaN/undefinedは0扱い", () => {
    expect(sum([{ v: 1 }, { v: NaN }, { v: 2 }], (x) => x.v)).toBe(3);
  });
});

describe("リードの獲得日時", () => {
  it("QRスキャン時刻があれば分単位まで(JST)", () => {
    // 2026-07-29 08:00 UTC = 17:00 JST
    expect(formatAcquiredAt("2026-07-29T08:00:00+00:00", "2026-07-29")).toBe("2026/7/29 17:00");
  });
  it("スキャン時刻が無ければ獲得日(日付のみ)", () => {
    expect(formatAcquiredAt(null, "2026-07-29")).toBe("2026/7/29");
  });
  it("どちらも無ければダッシュ", () => {
    expect(formatAcquiredAt(null, null)).toBe("—");
  });
});
