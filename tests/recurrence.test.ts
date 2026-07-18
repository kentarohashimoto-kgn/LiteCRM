import { describe, expect, it } from "vitest";
import { advanceEnds, nextOccurrence, recurrenceSummary, type Recurrence } from "@/lib/recurrence";

/* F-202 繰り返しの次回日付計算。E-5方針: 数字が狂うと信頼を失う計算は回帰テスト必須。 */

describe("nextOccurrence: daily", () => {
  it("毎日: 翌日を返す", () => {
    expect(nextOccurrence({ freq: "daily" }, "2026-07-17", "2026-07-17")).toBe("2026-07-18");
  });
  it("3日ごと: 基準日から3日刻み", () => {
    expect(nextOccurrence({ freq: "daily", interval: 3 }, "2026-07-17", "2026-07-17")).toBe("2026-07-20");
  });
  it("毎営業日: 金曜の次は月曜", () => {
    // 2026-07-17 は金曜
    expect(nextOccurrence({ freq: "daily", weekdaysOnly: true }, "2026-07-17", "2026-07-17")).toBe("2026-07-20");
  });
  it("超過完了: 今日以降で最初のルール日（過去日を量産しない）", () => {
    // 期日7/10のタスクを7/17に完了 → 7/18（明日）ではなく今日以降の最初=7/17は「今日」を含む
    expect(nextOccurrence({ freq: "daily" }, "2026-07-10", "2026-07-17")).toBe("2026-07-17");
  });
});

describe("nextOccurrence: weekly", () => {
  it("毎週 月・木: 金曜完了→次の月曜", () => {
    const rule: Recurrence = { freq: "weekly", weekdays: [1, 4] };
    expect(nextOccurrence(rule, "2026-07-16", "2026-07-16")).toBe("2026-07-20"); // 木曜due→次は月曜
  });
  it("曜日未指定: 基準日の曜日を使う", () => {
    // 2026-07-17 は金曜 → 次の金曜
    expect(nextOccurrence({ freq: "weekly" }, "2026-07-17", "2026-07-17")).toBe("2026-07-24");
  });
  it("隔週: 2週間後の同じ曜日", () => {
    expect(nextOccurrence({ freq: "weekly", interval: 2 }, "2026-07-17", "2026-07-17")).toBe("2026-07-31");
  });
  it("超過完了(毎週月曜を金曜に完了): 次の月曜1件だけ", () => {
    // 期日7/13(月)を7/17(金)に完了 → 7/20(月)
    expect(nextOccurrence({ freq: "weekly", weekdays: [1] }, "2026-07-13", "2026-07-17")).toBe("2026-07-20");
  });
});

describe("nextOccurrence: monthly", () => {
  it("毎月31日: 日数の少ない月は月末に丸める", () => {
    const rule: Recurrence = { freq: "monthly", monthlyMode: "day", monthDay: 31 };
    expect(nextOccurrence(rule, "2026-01-31", "2026-01-31")).toBe("2026-02-28"); // 2026年は平年
  });
  it("月末モード", () => {
    const rule: Recurrence = { freq: "monthly", monthlyMode: "last" };
    expect(nextOccurrence(rule, "2026-02-28", "2026-02-28")).toBe("2026-03-31");
  });
  it("第2火曜", () => {
    const rule: Recurrence = { freq: "monthly", monthlyMode: "nth", nth: 2, nthWeekday: 2 };
    // 2026-07-14 は第2火曜 → 次は 2026-08-11
    expect(nextOccurrence(rule, "2026-07-14", "2026-07-14")).toBe("2026-08-11");
  });
  it("第5月曜が無い月は最後の月曜に丸める", () => {
    const rule: Recurrence = { freq: "monthly", monthlyMode: "nth", nth: 5, nthWeekday: 1 };
    // 2026-06-29 は第5月曜。7月の月曜は4回 → 最後の月曜 7/27
    expect(nextOccurrence(rule, "2026-06-29", "2026-06-29")).toBe("2026-07-27");
  });
  it("3ヶ月ごと", () => {
    const rule: Recurrence = { freq: "monthly", interval: 3, monthlyMode: "day", monthDay: 15 };
    expect(nextOccurrence(rule, "2026-07-15", "2026-07-15")).toBe("2026-10-15");
  });
});

describe("nextOccurrence: yearly", () => {
  it("毎年同月同日", () => {
    expect(nextOccurrence({ freq: "yearly" }, "2026-07-17", "2026-07-17")).toBe("2027-07-17");
  });
  it("うるう年2/29: 平年は2/28に丸める", () => {
    expect(nextOccurrence({ freq: "yearly" }, "2024-02-29", "2024-02-29")).toBe("2025-02-28");
  });
});

describe("nextOccurrence: 終了条件", () => {
  it("指定日まで: 超えたら null", () => {
    const rule: Recurrence = { freq: "weekly", weekdays: [1], ends: { kind: "on_date", date: "2026-07-25" } };
    expect(nextOccurrence(rule, "2026-07-20", "2026-07-20")).toBeNull(); // 次候補 7/27 > 7/25
  });
  it("n回で終了: 上限に達したら null", () => {
    const rule: Recurrence = { freq: "daily", ends: { kind: "count", value: 3, done: 3 } };
    expect(nextOccurrence(rule, "2026-07-17", "2026-07-17")).toBeNull();
  });
  it("advanceEnds: 回数カウントを進める", () => {
    const rule: Recurrence = { freq: "daily", ends: { kind: "count", value: 3 } };
    const next = advanceEnds(rule);
    expect(next.ends).toEqual({ kind: "count", value: 3, done: 2 });
    expect(nextOccurrence(next, "2026-07-18", "2026-07-18")).toBe("2026-07-19");
    const last = advanceEnds(next);
    expect(nextOccurrence(last, "2026-07-19", "2026-07-19")).toBeNull();
  });
});

describe("recurrenceSummary", () => {
  it("日本語要約", () => {
    expect(recurrenceSummary({ freq: "weekly", weekdays: [4, 1] })).toBe("毎週 月・木");
    expect(recurrenceSummary({ freq: "daily", weekdaysOnly: true })).toBe("毎営業日");
    expect(recurrenceSummary({ freq: "monthly", monthlyMode: "last" })).toBe("毎月 月末");
    expect(recurrenceSummary({ freq: "monthly", monthlyMode: "nth", nth: 2, nthWeekday: 2 })).toBe("毎月 第2火曜");
    expect(recurrenceSummary({ freq: "daily", ends: { kind: "count", value: 10 } })).toBe("毎日（全10回）");
  });
});
