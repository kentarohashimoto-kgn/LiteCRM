/**
 * カレンダー非公開URLの検証。
 * 実運用で「公開URLを貼ってしまう」取り違えが起きたため、その判別を回帰として固定する。
 */
import { describe, expect, it } from "vitest";
import { validateFeedUrl } from "@/lib/calendar-feed-url";

const PRIVATE = "https://calendar.google.com/calendar/ical/kentaro.hashimoto%40catorce.jp/private-abc123/basic.ics";
const PUBLIC = "https://calendar.google.com/calendar/ical/kentaro.hashimoto%40catorce.jp/public/basic.ics";

describe("validateFeedUrl", () => {
  it("非公開URLを受け付ける", () => {
    expect(validateFeedUrl(PRIVATE)).toEqual({ ok: true, url: PRIVATE });
  });

  it("前後の空白は無視する", () => {
    expect(validateFeedUrl(`  ${PRIVATE}  `)).toEqual({ ok: true, url: PRIVATE });
  });

  it("公開URLは弾き、非公開URLの場所を案内する", () => {
    const res = validateFeedUrl(PUBLIC);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("公開URL");
      expect(res.error).toContain("/private-");
    }
  });

  it("webcal:// は https に読み替える", () => {
    const res = validateFeedUrl(PRIVATE.replace("https://", "webcal://"));
    expect(res).toEqual({ ok: true, url: PRIVATE });
  });

  it("Google以外のホストは弾く(SSRF防止)", () => {
    for (const bad of [
      "https://evil.example.com/calendar/ical/x/private-y/basic.ics",
      "http://localhost:3000/calendar/ical/x/private-y/basic.ics",
      "https://169.254.169.254/calendar/ical/x/private-y/basic.ics",
    ]) {
      expect(validateFeedUrl(bad).ok).toBe(false);
    }
  });

  it("https以外は弾く", () => {
    expect(validateFeedUrl("http://calendar.google.com/calendar/ical/x/private-y/basic.ics").ok).toBe(false);
  });

  it("iCalのURLでないものは弾く", () => {
    expect(validateFeedUrl("https://calendar.google.com/calendar/u/0/r").ok).toBe(false);
  });

  it("空・不正な文字列は弾く", () => {
    expect(validateFeedUrl("").ok).toBe(false);
    expect(validateFeedUrl("これはURLではありません").ok).toBe(false);
  });
});
