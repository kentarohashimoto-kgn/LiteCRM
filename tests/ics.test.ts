/**
 * ICS(iCalendar)パースと繰り返し予定展開の回帰テスト。
 * Googleカレンダーの非公開URL取り込みの土台。実カレンダーは50件中18件が
 * 繰り返し予定だったため、RRULE展開・EXDATE・個別変更(RECURRENCE-ID)を重点的に見る。
 */
import { describe, expect, it } from "vitest";
import { expandRRule, parseIcs, parseIcsDate, parseProp, parseRRule, unfoldLines, zonedTimeToUtc } from "@/lib/ics";

const TZ = "Asia/Tokyo";

function ics(...events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-TIMEZONE:Asia/Tokyo", ...events, "END:VCALENDAR"].join("\r\n");
}
function vevent(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

const WEEK_FROM = new Date("2026-07-26T15:00:00Z"); // 7/27 00:00 JST
const WEEK_TO = new Date("2026-08-02T15:00:00Z"); // 8/3 00:00 JST

describe("行の折り返し・プロパティ解析", () => {
  it("空白始まりの継続行を結合する", () => {
    expect(unfoldLines("SUMMARY:とても長い\r\n タイトル\r\nUID:1")).toEqual(["SUMMARY:とても長いタイトル", "UID:1"]);
  });

  it("パラメータつきプロパティを分解する", () => {
    const p = parseProp("DTSTART;TZID=Asia/Tokyo:20260727T090000");
    expect(p).toMatchObject({ name: "DTSTART", params: { TZID: "Asia/Tokyo" }, value: "20260727T090000" });
  });

  it("値の中のコロンは区切りにしない", () => {
    const p = parseProp("LOCATION:https://meet.google.com/abc");
    expect(p?.value).toBe("https://meet.google.com/abc");
  });
});

describe("日時の解釈", () => {
  it("Z付きはUTCとして読む", () => {
    expect(parseIcsDate("20260727T000000Z", {}, TZ)?.date.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("TZID付きはそのタイムゾーンのローカル時刻として読む", () => {
    // JST 09:00 = UTC 00:00
    expect(parseIcsDate("20260727T090000", { TZID: "Asia/Tokyo" }, TZ)?.date.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("日付のみは終日予定", () => {
    const v = parseIcsDate("20260727", {}, TZ);
    expect(v?.allDay).toBe(true);
  });

  it("夏時間のあるタイムゾーンも正しく変換する", () => {
    // ニューヨークの2026-07-01 12:00 は EDT(UTC-4) → 16:00Z
    expect(zonedTimeToUtc(2026, 7, 1, 12, 0, 0, "America/New_York").toISOString()).toBe("2026-07-01T16:00:00.000Z");
    // 冬は EST(UTC-5) → 17:00Z
    expect(zonedTimeToUtc(2026, 1, 15, 12, 0, 0, "America/New_York").toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
});

describe("RRULE の解析と展開", () => {
  it("FREQ/INTERVAL/BYDAY/COUNT を読む", () => {
    const r = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10", TZ);
    expect(r).toMatchObject({ freq: "WEEKLY", interval: 2, count: 10, byDay: ["MO", "WE"] });
  });

  it("毎日の予定を窓のぶんだけ展開する", () => {
    const start = zonedTimeToUtc(2026, 7, 1, 9, 0, 0, TZ);
    const occ = expandRRule(start, parseRRule("FREQ=DAILY", TZ)!, WEEK_FROM, WEEK_TO, TZ);
    expect(occ).toHaveLength(7);
  });

  it("毎週月曜の予定は週内に1回だけ出る", () => {
    const start = zonedTimeToUtc(2026, 6, 1, 13, 0, 0, TZ); // 2026-06-01 は月曜
    const occ = expandRRule(start, parseRRule("FREQ=WEEKLY;BYDAY=MO", TZ)!, WEEK_FROM, WEEK_TO, TZ);
    expect(occ).toHaveLength(1);
    expect(occ[0].toLocaleDateString("en-CA", { timeZone: TZ })).toBe("2026-07-27");
  });

  it("隔週(INTERVAL=2)は該当週にだけ出る", () => {
    const start = zonedTimeToUtc(2026, 7, 13, 10, 0, 0, TZ); // 月曜
    const rule = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", TZ)!;
    // 7/13, 7/27, 8/10 … → 対象週(7/27)に該当
    expect(expandRRule(start, rule, WEEK_FROM, WEEK_TO, TZ)).toHaveLength(1);
    // 1週ずれた週(7/20)には出ない
    const prevFrom = new Date("2026-07-19T15:00:00Z");
    const prevTo = new Date("2026-07-26T15:00:00Z");
    expect(expandRRule(start, rule, prevFrom, prevTo, TZ)).toHaveLength(0);
  });

  it("複数曜日(BYDAY=MO,WE,FR)を展開する", () => {
    const start = zonedTimeToUtc(2026, 7, 6, 9, 0, 0, TZ);
    const occ = expandRRule(start, parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR", TZ)!, WEEK_FROM, WEEK_TO, TZ);
    expect(occ).toHaveLength(3);
  });

  it("UNTIL を過ぎたら出ない", () => {
    const start = zonedTimeToUtc(2026, 6, 1, 9, 0, 0, TZ);
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=MO;UNTIL=20260710T000000Z", TZ)!;
    expect(expandRRule(start, rule, WEEK_FROM, WEEK_TO, TZ)).toHaveLength(0);
  });

  it("COUNT の回数で打ち切る", () => {
    const start = zonedTimeToUtc(2026, 7, 20, 9, 0, 0, TZ);
    const rule = parseRRule("FREQ=DAILY;COUNT=3", TZ)!;
    // 7/20,21,22 の3回のみ → 対象週(7/27〜)には出ない
    expect(expandRRule(start, rule, WEEK_FROM, WEEK_TO, TZ)).toHaveLength(0);
  });

  it("毎月第2火曜(BYDAY=2TU)を展開する", () => {
    const start = zonedTimeToUtc(2026, 1, 13, 15, 0, 0, TZ);
    const rule = parseRRule("FREQ=MONTHLY;BYDAY=2TU", TZ)!;
    const from = new Date("2026-07-31T15:00:00Z"); // 8/1 JST
    const to = new Date("2026-08-31T15:00:00Z");
    const occ = expandRRule(start, rule, from, to, TZ);
    expect(occ).toHaveLength(1);
    expect(occ[0].toLocaleDateString("en-CA", { timeZone: TZ })).toBe("2026-08-11"); // 8月の第2火曜
  });

  it("古い開始日でも暴走せず窓ぶんだけ返す", () => {
    const start = zonedTimeToUtc(2015, 1, 1, 9, 0, 0, TZ);
    const occ = expandRRule(start, parseRRule("FREQ=DAILY", TZ)!, WEEK_FROM, WEEK_TO, TZ);
    expect(occ).toHaveLength(7);
  });
});

describe("parseIcs 全体", () => {
  it("単発予定を取り込む", () => {
    const text = ics(
      vevent(["UID:a", "SUMMARY:NTTデータ関西Mtg", "DTSTART;TZID=Asia/Tokyo:20260728T140000", "DTEND;TZID=Asia/Tokyo:20260728T150000"]),
    );
    const events = parseIcs(text, WEEK_FROM, WEEK_TO);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ summary: "NTTデータ関西Mtg", date: "2026-07-28", allDay: false });
  });

  it("窓の外の予定は返さない", () => {
    const text = ics(vevent(["UID:a", "SUMMARY:来月", "DTSTART;TZID=Asia/Tokyo:20260910T140000"]));
    expect(parseIcs(text, WEEK_FROM, WEEK_TO)).toHaveLength(0);
  });

  it("キャンセル済みは除外する", () => {
    const text = ics(vevent(["UID:a", "SUMMARY:中止", "DTSTART;TZID=Asia/Tokyo:20260728T140000", "STATUS:CANCELLED"]));
    expect(parseIcs(text, WEEK_FROM, WEEK_TO)).toHaveLength(0);
  });

  it("繰り返し予定を展開する(週次MTG)", () => {
    const text = ics(
      vevent([
        "UID:weekly",
        "SUMMARY:週次T会",
        "DTSTART;TZID=Asia/Tokyo:20260601T130000",
        "DTEND;TZID=Asia/Tokyo:20260601T140000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
      ]),
    );
    const events = parseIcs(text, WEEK_FROM, WEEK_TO);
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-07-27");
  });

  it("EXDATE で個別に削除された回は出ない", () => {
    const text = ics(
      vevent([
        "UID:weekly",
        "SUMMARY:ランチ休憩",
        "DTSTART;TZID=Asia/Tokyo:20260601T120000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE;TZID=Asia/Tokyo:20260727T120000",
      ]),
    );
    expect(parseIcs(text, WEEK_FROM, WEEK_TO)).toHaveLength(0);
  });

  it("RECURRENCE-ID による個別変更は差し替えて1件だけ出す", () => {
    const text = ics(
      vevent(["UID:w", "SUMMARY:定例", "DTSTART;TZID=Asia/Tokyo:20260601T100000", "RRULE:FREQ=WEEKLY;BYDAY=MO"]),
      vevent([
        "UID:w",
        "SUMMARY:定例(時間変更)",
        "RECURRENCE-ID;TZID=Asia/Tokyo:20260727T100000",
        "DTSTART;TZID=Asia/Tokyo:20260727T160000",
      ]),
    );
    const events = parseIcs(text, WEEK_FROM, WEEK_TO);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("定例(時間変更)");
    expect(events[0].startAt).toBe("2026-07-27T07:00:00.000Z"); // JST 16:00
  });

  it("終日予定を扱える", () => {
    const text = ics(vevent(["UID:a", "SUMMARY:展示会", "DTSTART;VALUE=DATE:20260729", "DTEND;VALUE=DATE:20260730"]));
    const events = parseIcs(text, WEEK_FROM, WEEK_TO);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ allDay: true, date: "2026-07-29", startAt: null });
  });

  it("折り返された長いタイトルとエスケープを戻す", () => {
    const text = ics(
      vevent([
        "UID:a",
        "SUMMARY:株式会社きずな様｜生成AI基礎\r\n \\, 自走人材育成研修①",
        "DTSTART;TZID=Asia/Tokyo:20260728T090000",
      ]),
    );
    const events = parseIcs(text, WEEK_FROM, WEEK_TO);
    expect(events[0].summary).toBe("株式会社きずな様｜生成AI基礎, 自走人材育成研修①");
  });

  it("時刻順に並ぶ", () => {
    const text = ics(
      vevent(["UID:b", "SUMMARY:午後", "DTSTART;TZID=Asia/Tokyo:20260727T150000"]),
      vevent(["UID:a", "SUMMARY:午前", "DTSTART;TZID=Asia/Tokyo:20260727T090000"]),
    );
    expect(parseIcs(text, WEEK_FROM, WEEK_TO).map((e) => e.summary)).toEqual(["午前", "午後"]);
  });

  it("VTIMEZONEブロックを予定として誤読しない", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Tokyo",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "END:STANDARD",
      "END:VTIMEZONE",
      vevent(["UID:a", "SUMMARY:予定", "DTSTART;TZID=Asia/Tokyo:20260728T090000"]),
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(text, WEEK_FROM, WEEK_TO);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("予定");
  });
});
