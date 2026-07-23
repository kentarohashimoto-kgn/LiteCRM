import { describe, it, expect } from "vitest";
import { deriveFirstMeeting, jstDate } from "@/lib/meeting-sync";

describe("jstDate", () => {
  it("UTCの深夜をJSTの当日/翌日に正しく丸める", () => {
    // 2026-07-27 06:00Z = 15:00 JST(同日)
    expect(jstDate("2026-07-27T06:00:00Z")).toBe("2026-07-27");
    // 2026-07-27 16:00Z = 翌1:00 JST(翌日)
    expect(jstDate("2026-07-27T16:00:00Z")).toBe("2026-07-28");
  });
});

describe("deriveFirstMeeting", () => {
  it("最も早い商談から日付/時刻を導出する", () => {
    const r = deriveFirstMeeting([
      { meeting_date: "2026-07-27", meeting_at: "2026-07-27T06:00:00Z" }, // 7/27 15:00 JST
      { meeting_date: "2026-08-10", meeting_at: "2026-08-10T01:00:00Z" },
    ]);
    expect(r).toEqual({ first_meeting_date: "2026-07-27", appointment_at: "2026-07-27T06:00:00Z" });
  });

  it("再現バグ: 初回商談を後の日付へ振り替えたら案件側もその日に追従する", () => {
    // PLAN K を模したケース。商談が7/27に振り替わった後は 7/27 が正。
    const r = deriveFirstMeeting([
      { meeting_date: "2026-07-27", meeting_at: "2026-07-27T06:00:00Z" },
    ]);
    expect(r?.first_meeting_date).toBe("2026-07-27");
  });

  it("時刻なし(meeting_dateのみ)は appointment_at=null / 日付はそのまま", () => {
    const r = deriveFirstMeeting([{ meeting_date: "2026-07-08", meeting_at: null }]);
    expect(r).toEqual({ first_meeting_date: "2026-07-08", appointment_at: null });
  });

  it("時刻あり商談と時刻なし商談が混在しても、暦日で最も早いものを選ぶ", () => {
    const r = deriveFirstMeeting([
      { meeting_date: "2026-07-09", meeting_at: "2026-07-09T02:00:00Z" }, // 7/9 11:00 JST
      { meeting_date: "2026-07-08", meeting_at: null }, // 7/8(時刻なし)= より早い
    ]);
    expect(r).toEqual({ first_meeting_date: "2026-07-08", appointment_at: null });
  });

  it("有効な日付が無ければ null(案件側を変更しない)", () => {
    expect(deriveFirstMeeting([])).toBeNull();
    expect(deriveFirstMeeting([{ meeting_date: null, meeting_at: null }])).toBeNull();
  });
});
