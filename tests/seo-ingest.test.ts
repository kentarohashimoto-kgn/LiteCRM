import { describe, it, expect } from "vitest";
import { buildPageRows, buildQueryRows, buildGa4Aggregates, rollupWeekly, type IngestSite } from "@/lib/seo/ingest";
import { weekStartJst } from "@/lib/seo/site-match";

const SITES: IngestSite[] = [
  { id: "honsha", tenantId: "T1", pathPrefix: "/", excludePrefixes: ["/career/"] },
  { id: "carepla", tenantId: "T1", pathPrefix: "/career/", excludePrefixes: [] },
];

const row = (keys: string[], clicks: number, impressions: number, position: number) => ({
  keys,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

describe("buildPageRows", () => {
  it("同一ドメインの行を本体とキャリプラに振り分ける", () => {
    const { daily, pages } = buildPageRows(
      [
        row(["2026-07-20", "https://catorce.jp/service/ai-training"], 10, 200, 8),
        row(["2026-07-20", "https://catorce.jp/career/freelance"], 5, 100, 12),
      ],
      SITES,
    );
    const honsha = daily.find((d) => d.site_id === "honsha");
    const carepla = daily.find((d) => d.site_id === "carepla");
    expect(honsha?.clicks).toBe(10);
    expect(honsha?.impressions).toBe(200);
    expect(carepla?.clicks).toBe(5);
    expect(pages).toHaveLength(2);
  });

  it("サイト日次の平均順位は表示回数の加重平均になる", () => {
    const { daily } = buildPageRows(
      [
        row(["2026-07-20", "https://catorce.jp/a"], 0, 1000, 2),
        row(["2026-07-20", "https://catorce.jp/b"], 0, 10, 60),
      ],
      SITES,
    );
    const d = daily.find((x) => x.site_id === "honsha")!;
    // 単純平均なら31だが、加重平均なので2に近い
    expect(d.position!).toBeGreaterThan(2);
    expect(d.position!).toBeLessThan(3);
    expect(d.ctr).toBe(0);
  });

  it("クエリ文字列違いの同一ページを1行に統合する", () => {
    const { pages } = buildPageRows(
      [
        row(["2026-07-20", "https://catorce.jp/contact?utm_source=google"], 3, 30, 5),
        row(["2026-07-20", "https://catorce.jp/contact"], 2, 20, 5),
      ],
      SITES,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].page_path).toBe("/contact");
    expect(pages[0].clicks).toBe(5);
    expect(pages[0].impressions).toBe(50);
  });

  it("どのサイトにも属さない行は捨てる", () => {
    const only = [{ id: "carepla", tenantId: "T1", pathPrefix: "/career/", excludePrefixes: [] }];
    const { daily, pages } = buildPageRows([row(["2026-07-20", "https://catorce.jp/service"], 9, 90, 3)], only);
    expect(daily).toHaveLength(0);
    expect(pages).toHaveLength(0);
  });

  it("日ごとに表示回数上位300件までに制限する", () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      row(["2026-07-20", `https://catorce.jp/p${i}`], 0, i + 1, 10),
    );
    const { pages } = buildPageRows(many, SITES);
    expect(pages).toHaveLength(300);
    // 最も表示回数が少ない行から捨てられる
    expect(pages.every((p) => p.impressions >= 101)).toBe(true);
  });
});

describe("buildQueryRows", () => {
  it("クエリ×ページ単位で集計し、サイトに振り分ける", () => {
    const rows = buildQueryRows(
      [
        row(["2026-07-20", "生成AI研修 費用", "https://catorce.jp/price"], 4, 120, 6),
        row(["2026-07-20", "フリーランス 単価", "https://catorce.jp/career/rate"], 2, 80, 15),
      ],
      SITES,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.query === "生成AI研修 費用")?.site_id).toBe("honsha");
    expect(rows.find((r) => r.query === "フリーランス 単価")?.site_id).toBe("carepla");
  });

  it("クエリが空の行は捨てる", () => {
    expect(buildQueryRows([row(["2026-07-20", "", "https://catorce.jp/a"], 1, 1, 1)], SITES)).toHaveLength(0);
  });
});

describe("buildGa4Aggregates", () => {
  it("ページパスからサイトを判定してセッションを合算する", () => {
    const agg = buildGa4Aggregates(
      [
        { date: "2026-07-20", pagePath: "/service/ai-training", sessions: 30, engagedSessions: 20, userEngagementSec: 600 },
        { date: "2026-07-20", pagePath: "/price", sessions: 10, engagedSessions: 8, userEngagementSec: 200 },
        { date: "2026-07-20", pagePath: "/career/jobs", sessions: 50, engagedSessions: 25, userEngagementSec: 900 },
      ],
      SITES,
    );
    expect(agg.find((a) => a.siteId === "honsha")?.sessions).toBe(40);
    expect(agg.find((a) => a.siteId === "carepla")?.sessions).toBe(50);
  });
});

describe("rollupWeekly", () => {
  it("同一週の日次行を1行に畳み、順位は加重平均になる", () => {
    const daily = [
      { tenant_id: "T1", site_id: "honsha", date: "2026-07-27", page_path: "/a", clicks: 3, impressions: 100, ctr: 0.03, position: 10 },
      { tenant_id: "T1", site_id: "honsha", date: "2026-07-29", page_path: "/a", clicks: 7, impressions: 900, ctr: 0.0078, position: 4 },
    ];
    const weekly = rollupWeekly(daily, weekStartJst, (r) => r.page_path);
    expect(weekly).toHaveLength(1);
    expect(weekly[0].week_start).toBe("2026-07-27");
    expect(weekly[0].clicks).toBe(10);
    expect(weekly[0].impressions).toBe(1000);
    // (10*100 + 4*900)/1000 = 4.6
    expect(weekly[0].position).toBeCloseTo(4.6, 2);
  });

  it("週をまたぐと別行になる", () => {
    const daily = [
      { tenant_id: "T1", site_id: "honsha", date: "2026-07-26", page_path: "/a", clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
      { tenant_id: "T1", site_id: "honsha", date: "2026-07-27", page_path: "/a", clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
    ];
    expect(rollupWeekly(daily, weekStartJst, (r) => r.page_path)).toHaveLength(2);
  });
});
