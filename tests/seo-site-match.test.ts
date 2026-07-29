import { describe, it, expect } from "vitest";
import {
  normalizePath,
  pathHasPrefix,
  matchSiteByPath,
  weightedPosition,
  ctrOf,
  weekStartJst,
  addDays,
} from "@/lib/seo/site-match";

/**
 * catorce.jp の実構成を再現したサイト定義。
 * 本体(B2B)と /career/(B2C) の振り分けを誤ると全集計が汚染されるため、
 * ここは重点的にテストする。
 */
const SITES = [
  { id: "honsha", pathPrefix: "/", excludePrefixes: ["/career/"] },
  { id: "carepla", pathPrefix: "/career/", excludePrefixes: [] },
];

describe("normalizePath", () => {
  it("絶対URLからパスだけを取り出す", () => {
    expect(normalizePath("https://catorce.jp/blog/ai-training")).toBe("/blog/ai-training");
  });
  it("クエリとフラグメントを落とす（utm付きURLで行が分裂しない）", () => {
    expect(normalizePath("https://catorce.jp/contact?utm_source=google#form")).toBe("/contact");
    expect(normalizePath("/contact?utm_medium=organic")).toBe("/contact");
  });
  it("先頭スラッシュを補う", () => {
    expect(normalizePath("blog/post")).toBe("/blog/post");
  });
  it("index.html と連続スラッシュを正規化する", () => {
    expect(normalizePath("https://catorce.jp/career/index.html")).toBe("/career/");
    expect(normalizePath("//blog//post")).toBe("/blog/post");
  });
  it("空文字や壊れた入力でも落ちない", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("https://")).toBe("/");
  });
});

describe("pathHasPrefix", () => {
  it("'/' は全てにマッチする", () => {
    expect(pathHasPrefix("/anything/deep", "/")).toBe(true);
  });
  it("末尾スラッシュの有無を吸収する", () => {
    expect(pathHasPrefix("/career", "/career/")).toBe(true);
    expect(pathHasPrefix("/career/", "/career/")).toBe(true);
    expect(pathHasPrefix("/career/jobs", "/career/")).toBe(true);
  });
  it("前方一致の途中で切れる別パスにはマッチしない", () => {
    expect(pathHasPrefix("/careers-info", "/career/")).toBe(false);
  });
});

describe("matchSiteByPath", () => {
  it("本体のページは本体サイトに割り当てる", () => {
    expect(matchSiteByPath("/service/ai-training", SITES)?.id).toBe("honsha");
    expect(matchSiteByPath("/", SITES)?.id).toBe("honsha");
  });
  it("/career/ 配下はキャリプラに割り当てる（本体には入れない）", () => {
    expect(matchSiteByPath("/career/", SITES)?.id).toBe("carepla");
    expect(matchSiteByPath("/career/freelance-guide", SITES)?.id).toBe("carepla");
  });
  it("除外指定がなくても、より長い接頭辞が勝つ", () => {
    const sites = [
      { id: "honsha", pathPrefix: "/", excludePrefixes: [] },
      { id: "carepla", pathPrefix: "/career/", excludePrefixes: [] },
    ];
    expect(matchSiteByPath("/career/jobs", sites)?.id).toBe("carepla");
  });
  it("どのサイトにも属さない場合は null", () => {
    const sites = [{ id: "carepla", pathPrefix: "/career/", excludePrefixes: [] }];
    expect(matchSiteByPath("/service", sites)).toBeNull();
  });
});

describe("weightedPosition", () => {
  it("表示回数で重み付けする（単純平均にしない）", () => {
    // 順位1位が10,000表示、順位50位が1表示。単純平均なら25.5だが、実態はほぼ1位。
    const pos = weightedPosition([
      { position: 1, impressions: 10000 },
      { position: 50, impressions: 1 },
    ]);
    expect(pos).not.toBeNull();
    expect(pos!).toBeLessThan(1.1);
  });
  it("表示回数が0の行は無視する", () => {
    expect(weightedPosition([{ position: 3, impressions: 100 }, { position: 99, impressions: 0 }])).toBe(3);
  });
  it("有効な行がなければ null", () => {
    expect(weightedPosition([])).toBeNull();
    expect(weightedPosition([{ position: 5, impressions: 0 }])).toBeNull();
  });
});

describe("ctrOf", () => {
  it("表示回数0のときは null（0%と未計測を区別する）", () => {
    expect(ctrOf(0, 0)).toBeNull();
    expect(ctrOf(0, 100)).toBe(0);
  });
  it("小数4桁に丸める", () => {
    expect(ctrOf(42, 1000)).toBe(0.042);
  });
});

describe("weekStartJst", () => {
  it("週の月曜を返す", () => {
    // 2026-07-29 は水曜 → 同週の月曜は 2026-07-27
    expect(weekStartJst("2026-07-29")).toBe("2026-07-27");
  });
  it("月曜はその日自身を返す", () => {
    expect(weekStartJst("2026-07-27")).toBe("2026-07-27");
  });
  it("日曜は同じ週の月曜（前週側）を返す", () => {
    // 2026-08-02 は日曜 → 2026-07-27
    expect(weekStartJst("2026-08-02")).toBe("2026-07-27");
  });
  it("月をまたいでも正しい", () => {
    // 2026-08-01 は土曜 → 2026-07-27
    expect(weekStartJst("2026-08-01")).toBe("2026-07-27");
  });
});

describe("addDays", () => {
  it("前後に日付をずらせる", () => {
    expect(addDays("2026-07-29", -3)).toBe("2026-07-26");
    expect(addDays("2026-07-29", 3)).toBe("2026-08-01");
  });
});
