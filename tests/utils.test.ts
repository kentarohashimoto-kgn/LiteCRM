/**
 * E-5 回帰テスト: 金額表示・日付ユーティリティ。
 */
import { describe, expect, it } from "vitest";
import { formatYen, formatManYen, formatPercent, monthKey, daysSince, sameMonth, sum, formatAcquiredAt, formatDate, formatDateFull, formatDateTimeJst, formatDateTimeSecJst, formatTimeJst, toJstDate, formatMonth } from "@/lib/utils";

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
    // 実行環境のTZに依存しないよう、基準は具体的な瞬間(UTC)で与える
    const now = new Date("2026-07-15T00:00:00Z");
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

describe("日時表示は実行環境のTZに依存せずJST固定", () => {
  // サーバー(Vercel)はUTCで動くため、ローカル時刻ゲッターを使うとUTCのまま表示され
  // JSTの0:00〜9:00は日付まで1日ずれる。以下はその回帰固定。
  it("送信日時はJSTで表示される(UTC 14:26 → JST 23:26)", () => {
    expect(formatDateTimeJst("2026-07-30T14:26:55.993Z")).toBe("2026/7/30 23:26");
    expect(formatDateTimeSecJst("2026-07-30T14:26:55.993Z")).toBe("2026/7/30 23:26:55");
  });
  it("UTCで日付が変わらない時刻でもJSTでは翌日になる", () => {
    // 2026-07-30 16:00 UTC = 2026-07-31 01:00 JST
    expect(formatDateTimeJst("2026-07-30T16:00:00Z")).toBe("2026/7/31 01:00");
    expect(formatDateFull("2026-07-30T16:00:00Z")).toBe("2026/7/31");
    expect(formatDate("2026-07-30T16:00:00Z")).toBe("7/31");
    expect(toJstDate("2026-07-30T16:00:00Z")).toBe("2026-07-31");
    expect(formatMonth("2026-12-31T16:00:00Z")).toBe("2027年1月");
  });
  it("日付のみの値(獲得日など)は日付がずれない", () => {
    expect(formatDateFull("2026-07-29")).toBe("2026/7/29");
    expect(formatDate("2026-07-29")).toBe("7/29");
  });
  it("時刻は0埋め", () => {
    expect(formatTimeJst("2026-07-30T00:05:00Z")).toBe("09:05");
  });
  it("空・不正値の扱いは変えない", () => {
    expect(formatDateTimeJst(null)).toBe("—");
    expect(formatDateTimeSecJst("not-a-date")).toBe("—");
    expect(formatTimeJst(null)).toBe("");
    expect(toJstDate(null)).toBeNull();
  });
});
