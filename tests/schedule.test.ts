/**
 * 予約送信(0179) 回帰テスト: JST↔UTC変換・プリセット・バリデーション。
 */
import { describe, expect, it } from "vitest";
import {
  isoToJstLocalInput,
  jstLocalInputToIso,
  formatJstSchedule,
  schedulePresets,
  validateScheduleAt,
  isOutsideBusinessHours,
} from "@/lib/schedule";

describe("JST ↔ UTC 変換", () => {
  it("JSTの入力値をUTCのISOに変換する", () => {
    // 2026-07-30 09:00 JST = 2026-07-30 00:00 UTC
    expect(jstLocalInputToIso("2026-07-30T09:00")).toBe("2026-07-30T00:00:00.000Z");
  });
  it("UTCのISOをJSTの入力値に戻す(往復で一致)", () => {
    const local = "2026-07-30T09:00";
    expect(isoToJstLocalInput(jstLocalInputToIso(local))).toBe(local);
  });
  it("日付をまたぐ変換", () => {
    // 2026-07-30 08:00 JST = 2026-07-29 23:00 UTC
    expect(jstLocalInputToIso("2026-07-30T08:00")).toBe("2026-07-29T23:00:00.000Z");
    expect(isoToJstLocalInput("2026-07-29T23:00:00.000Z")).toBe("2026-07-30T08:00");
  });
  it("表示は JST の 月/日(曜) 時:分", () => {
    // 2026-07-30 は木曜
    expect(formatJstSchedule("2026-07-30T00:00:00.000Z")).toBe("7/30(木) 09:00");
  });
});

describe("プリセット", () => {
  // 2026-07-29(水) 10:00 JST = 2026-07-29T01:00:00Z
  const now = Date.parse("2026-07-29T01:00:00.000Z");
  it("明日の朝は翌日8:00 JST", () => {
    const p = schedulePresets(now).find((x) => x.key === "tomorrow_morning")!;
    expect(formatJstSchedule(p.iso)).toBe("7/30(木) 08:00");
  });
  it("夕方前なら「今日の夕方17:00」", () => {
    const p = schedulePresets(now).find((x) => x.key === "today_evening")!;
    expect(formatJstSchedule(p.iso)).toBe("7/29(水) 17:00");
  });
  it("夕方を過ぎたら「明日の夕方」に切り替わる", () => {
    const evening = Date.parse("2026-07-29T09:00:00.000Z"); // 18:00 JST
    const keys = schedulePresets(evening).map((x) => x.key);
    expect(keys).toContain("tomorrow_evening");
    expect(keys).not.toContain("today_evening");
  });
  it("来週の月曜は次の月曜9:00(当日が月曜なら翌週)", () => {
    const p = schedulePresets(now).find((x) => x.key === "next_monday")!;
    expect(formatJstSchedule(p.iso)).toBe("8/3(月) 09:00");
    // 月曜(2026-08-03 10:00 JST)に実行すると翌週の月曜
    const monday = Date.parse("2026-08-03T01:00:00.000Z");
    const p2 = schedulePresets(monday).find((x) => x.key === "next_monday")!;
    expect(formatJstSchedule(p2.iso)).toBe("8/10(月) 09:00");
  });
  it("すべてのプリセットは未来", () => {
    for (const p of schedulePresets(now)) {
      expect(validateScheduleAt(p.iso, now).ok).toBe(true);
    }
  });
});

describe("バリデーション", () => {
  const now = Date.parse("2026-07-29T01:00:00.000Z");
  it("過去・直近1分以内は不可", () => {
    expect(validateScheduleAt("2026-07-29T00:00:00.000Z", now).ok).toBe(false);
    expect(validateScheduleAt("2026-07-29T01:00:30.000Z", now).ok).toBe(false);
  });
  it("1年より先は不可", () => {
    expect(validateScheduleAt("2027-09-01T00:00:00.000Z", now).ok).toBe(false);
  });
  it("妥当な未来はOK", () => {
    expect(validateScheduleAt("2026-07-30T00:00:00.000Z", now).ok).toBe(true);
  });
  it("不正な文字列は不可", () => {
    expect(validateScheduleAt("not-a-date", now).ok).toBe(false);
  });
});

describe("営業時間の判定(注意喚起用)", () => {
  it("平日9時は営業時間内", () => {
    expect(isOutsideBusinessHours("2026-07-30T00:00:00.000Z")).toBe(false); // 木 09:00 JST
  });
  it("平日7時・19時は時間外", () => {
    expect(isOutsideBusinessHours("2026-07-29T22:00:00.000Z")).toBe(true); // 木 07:00 JST
    expect(isOutsideBusinessHours("2026-07-30T10:00:00.000Z")).toBe(true); // 木 19:00 JST
  });
  it("土日は時間外", () => {
    expect(isOutsideBusinessHours("2026-08-01T01:00:00.000Z")).toBe(true); // 土 10:00 JST
    expect(isOutsideBusinessHours("2026-08-02T01:00:00.000Z")).toBe(true); // 日 10:00 JST
  });
});
