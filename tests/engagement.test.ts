/**
 * F-201/F-204 回帰テスト: エンゲージメント計算(重み・資料判定・優先グレード)。
 */
import { describe, expect, it } from "vitest";
import {
  MAIL_TOUCH_WEIGHTS,
  isDocumentUrl,
  clickTouchType,
  resolveFitScore,
  computeGrade,
} from "@/lib/engagement";

describe("MAIL_TOUCH_WEIGHTS", () => {
  it("返信 > 資料閲覧 > クリック > 開封 の順で重い", () => {
    expect(MAIL_TOUCH_WEIGHTS.email_reply).toBeGreaterThan(MAIL_TOUCH_WEIGHTS.doc_view);
    expect(MAIL_TOUCH_WEIGHTS.doc_view).toBeGreaterThan(MAIL_TOUCH_WEIGHTS.email_click);
    expect(MAIL_TOUCH_WEIGHTS.email_click).toBeGreaterThan(MAIL_TOUCH_WEIGHTS.email_open);
  });
});

describe("isDocumentUrl / clickTouchType", () => {
  it("PDF・Drive・Docs は資料と判定", () => {
    expect(isDocumentUrl("https://example.com/service.pdf")).toBe(true);
    expect(isDocumentUrl("https://example.com/deck.PDF?utm=x")).toBe(true);
    expect(isDocumentUrl("https://drive.google.com/file/d/abc/view")).toBe(true);
    expect(isDocumentUrl("https://docs.google.com/presentation/d/abc")).toBe(true);
  });
  it("通常ページは資料でない", () => {
    expect(isDocumentUrl("https://catorce.co.jp/")).toBe(false);
    expect(isDocumentUrl("https://catorce.co.jp/pricing")).toBe(false);
  });
  it("clickTouchType が種別へ振り分ける", () => {
    expect(clickTouchType("https://example.com/a.pdf")).toBe("doc_view");
    expect(clickTouchType("https://example.com/lp")).toBe("email_click");
    expect(clickTouchType(null)).toBe("email_click");
  });
});

describe("resolveFitScore", () => {
  it("lead_score があれば優先", () => {
    expect(resolveFitScore(72, "C")).toBe(72);
  });
  it("無ければランク文字から代表値", () => {
    expect(resolveFitScore(null, "S")).toBe(85);
    expect(resolveFitScore(0, "a")).toBe(70);
    expect(resolveFitScore(undefined, "D")).toBe(20);
  });
  it("どちらも無ければ null", () => {
    expect(resolveFitScore(null, null)).toBeNull();
    expect(resolveFitScore(null, "X")).toBeNull();
  });
});

describe("computeGrade (Fit×Engagement マトリクス)", () => {
  it("高Fit×高Eng = P1(今すぐ)", () => {
    expect(computeGrade(80, 20)).toBe("P1");
  });
  it("高Fit×反応なし = P3(ナーチャリング)", () => {
    expect(computeGrade(80, 0)).toBe("P3");
  });
  it("低Fit×高Eng = P3(メールで反応確認)", () => {
    expect(computeGrade(30, 20)).toBe("P3");
  });
  it("中Fit×中Eng = P3", () => {
    expect(computeGrade(55, 5)).toBe("P3");
  });
  it("低Fit×反応なし = P5", () => {
    expect(computeGrade(20, 0)).toBe("P5");
  });
  it("Fit不明は保守的に低Fit扱い", () => {
    expect(computeGrade(null, 20)).toBe("P3");
    expect(computeGrade(null, 0)).toBe("P5");
  });
  it("境界値: Fit65/Eng15 が P1 に入る", () => {
    expect(computeGrade(65, 15)).toBe("P1");
    expect(computeGrade(64, 15)).toBe("P2");
    expect(computeGrade(65, 14)).toBe("P2");
  });
});
