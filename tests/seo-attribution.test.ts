import { describe, it, expect } from "vitest";
import { classifyAcquisition, normalizeAttribution, isOrganic } from "@/lib/seo/attribution";

/**
 * 流入判定を誤ると「SEOがいくら売上を生んだか」が丸ごと狂う。
 * 特に広告流入をSEOに数えてしまう誤りは、施策の意思決定を直接壊すため重点的に検証する。
 */

describe("classifyAcquisition", () => {
  it("検索エンジンからのリファラは organic", () => {
    expect(classifyAcquisition({ referrer: "https://www.google.com/" })).toBe("organic");
    expect(classifyAcquisition({ referrer: "https://search.yahoo.co.jp/search" })).toBe("organic");
    expect(classifyAcquisition({ referrer: "https://www.bing.com/search?q=x" })).toBe("organic");
  });

  it("広告クリックIDがあれば、検索からの流入でも paid にする", () => {
    // ここを取り違えると広告費で買ったリードをSEOの成果に計上してしまう
    expect(classifyAcquisition({ referrer: "https://www.google.com/", gclid: "abc123" })).toBe("paid");
  });

  it("utm_medium=cpc は paid", () => {
    expect(classifyAcquisition({ utmMedium: "cpc", referrer: "https://www.google.com/" })).toBe("paid");
    expect(classifyAcquisition({ utmMedium: "PPC" })).toBe("paid");
  });

  it("utm_medium=organic は organic", () => {
    expect(classifyAcquisition({ utmMedium: "organic", utmSource: "google" })).toBe("organic");
  });

  it("メール・SNS は検索と分けて数える", () => {
    expect(classifyAcquisition({ utmMedium: "email" })).toBe("email");
    expect(classifyAcquisition({ referrer: "https://x.com/someone" })).toBe("social");
    expect(classifyAcquisition({ referrer: "https://www.facebook.com/" })).toBe("social");
  });

  it("リファラ無しは direct、他サイトからは referral", () => {
    expect(classifyAcquisition({})).toBe("direct");
    expect(classifyAcquisition({ referrer: "" })).toBe("direct");
    expect(classifyAcquisition({ referrer: "https://partner.example.co.jp/list" })).toBe("referral");
  });

  it("壊れたリファラでも落ちず unknown を返す", () => {
    expect(classifyAcquisition({ referrer: "not-a-url" })).toBe("unknown");
  });
});

describe("isOrganic", () => {
  it("SEOの成果として数えるのは organic のみ", () => {
    expect(isOrganic("organic")).toBe(true);
    for (const t of ["paid", "direct", "referral", "email", "social", "unknown"] as const) {
      expect(isOrganic(t)).toBe(false);
    }
  });
});

describe("normalizeAttribution", () => {
  it("着地ページはクエリを落としたパスにする（同一ページが分裂しない）", () => {
    const a = normalizeAttribution({ landing_page: "https://catorce.jp/blog/ai-cost?utm_source=google" });
    expect(a.landingPage).toBe("/blog/ai-cost");
  });

  it("キャメルケース・page_url も受け付ける（HP側の実装差を吸収）", () => {
    expect(normalizeAttribution({ landingPage: "/a" }).landingPage).toBe("/a");
    expect(normalizeAttribution({ page_url: "/b" }).landingPage).toBe("/b");
  });

  it("utm一式を取り込み、流入種別まで判定する", () => {
    const a = normalizeAttribution({
      landing_page: "/price",
      referrer: "https://www.google.com/",
      utm_source: "google",
      utm_medium: "organic",
      utm_campaign: "seo",
    });
    expect(a.utmSource).toBe("google");
    expect(a.utmCampaign).toBe("seo");
    expect(a.acquisitionType).toBe("organic");
  });

  it("何も送られなくても落ちず、direct として扱う", () => {
    const a = normalizeAttribution({});
    expect(a.landingPage).toBeNull();
    expect(a.acquisitionType).toBe("direct");
  });

  it("長すぎる値は切り詰める（DB制約とログ肥大の防止）", () => {
    const a = normalizeAttribution({ utm_campaign: "x".repeat(500) });
    expect(a.utmCampaign?.length).toBe(200);
  });
});
