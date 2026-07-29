import { describe, it, expect } from "vitest";
import {
  buildFunnelTargets,
  findBottleneck,
  inquiryUpliftFromCvr,
  completionRate,
  coverageRate,
  DEFAULT_RATES,
  type FunnelActuals,
} from "@/lib/seo/strategy";

const ZERO: FunnelActuals = {
  impressions: 0,
  clicks: 0,
  sessions: 0,
  inquiries: 0,
  leadsValid: 0,
  opportunities: 0,
  revenue: 0,
};

describe("buildFunnelTargets", () => {
  it("月¥300万から各段の必要数値を逆算する（戦略ドキュメント §1.2 と一致）", () => {
    const t = buildFunnelTargets(3_000_000, DEFAULT_RATES, ZERO);
    const by = Object.fromEntries(t.map((r) => [r.stage, r.target]));
    // 受注 = 3,000,000 / 1,800,000 = 1.67件 → 商談 3.44 → リード 13.7 → 問合せ 19.6
    expect(by.opportunities).toBeGreaterThan(3);
    expect(by.opportunities).toBeLessThan(4);
    expect(by.inquiries).toBeGreaterThan(19);
    expect(by.inquiries).toBeLessThan(21);
    // セッション約1,000 / 表示回数約26,000
    expect(by.sessions).toBeGreaterThan(950);
    expect(by.sessions).toBeLessThan(1050);
    expect(by.impressions).toBeGreaterThan(24000);
    expect(by.impressions).toBeLessThan(28000);
  });

  it("上流ほど大きい数字になる（ファネルの向きが逆転しない）", () => {
    const t = buildFunnelTargets(3_000_000, DEFAULT_RATES, ZERO);
    const get = (s: string) => t.find((r) => r.stage === s)!.target;
    expect(get("impressions")).toBeGreaterThan(get("clicks"));
    expect(get("clicks")).toBeGreaterThan(get("sessions"));
    expect(get("sessions")).toBeGreaterThan(get("inquiries"));
    expect(get("inquiries")).toBeGreaterThan(get("leads"));
    expect(get("leads")).toBeGreaterThan(get("opportunities"));
  });

  it("達成率とギャップを計算する", () => {
    const t = buildFunnelTargets(3_000_000, DEFAULT_RATES, { ...ZERO, sessions: 500 });
    const s = t.find((r) => r.stage === "sessions")!;
    expect(s.achievement!).toBeGreaterThan(0.45);
    expect(s.achievement!).toBeLessThan(0.55);
    expect(s.gap).toBeGreaterThan(400);
  });

  it("レートが0でも0除算で壊れない（目標が Infinity にならない）", () => {
    const t = buildFunnelTargets(3_000_000, { ...DEFAULT_RATES, inquiryCvr: 0 }, ZERO);
    for (const r of t) expect(Number.isFinite(r.target)).toBe(true);
  });

  it("目標0なら達成率は null（0%と未設定を区別する）", () => {
    const t = buildFunnelTargets(0, DEFAULT_RATES, ZERO);
    expect(t.every((r) => r.achievement === null)).toBe(true);
  });
});

describe("findBottleneck", () => {
  it("最も達成率が低い段を返す", () => {
    const t = buildFunnelTargets(3_000_000, DEFAULT_RATES, {
      ...ZERO,
      impressions: 26000,
      clicks: 1000,
      sessions: 950,
      inquiries: 2, // ここだけ極端に低い
      leadsValid: 2,
      opportunities: 1,
    });
    expect(findBottleneck(t)?.stage).toBe("revenue"); // 売上0が最下位
  });

  it("同率なら上流を優先する（上流が詰まると下流は直せないため）", () => {
    const t = buildFunnelTargets(1_000_000, DEFAULT_RATES, ZERO).map((r) => ({ ...r, achievement: 0.5 }));
    expect(findBottleneck(t)?.stage).toBe("impressions");
  });

  it("達成率が全てnullなら null", () => {
    expect(findBottleneck(buildFunnelTargets(0, DEFAULT_RATES, ZERO))).toBeNull();
  });
});

describe("inquiryUpliftFromCvr", () => {
  it("CVR改善で得られる追加問合せ数（追加流入ゼロ）", () => {
    expect(inquiryUpliftFromCvr(1000, 0.012, 0.02)).toBeCloseTo(8, 1);
  });
  it("目標が現状以下なら0", () => {
    expect(inquiryUpliftFromCvr(1000, 0.03, 0.02)).toBe(0);
  });
  it("セッション0なら0", () => {
    expect(inquiryUpliftFromCvr(0, 0.01, 0.02)).toBe(0);
  });
});

describe("completionRate", () => {
  it("ピラー1本 + 記事target本 を分母にする", () => {
    expect(completionRate(true, 5, 10)).toBeCloseTo(6 / 11, 2);
    expect(completionRate(false, 0, 8)).toBe(0);
    expect(completionRate(true, 10, 10)).toBe(1);
  });
  it("目標を超える記事数でも100%を超えない", () => {
    expect(completionRate(true, 30, 10)).toBe(1);
  });
});

describe("coverageRate", () => {
  it("10位以内の割合を返す", () => {
    expect(coverageRate(6, 42)).toBeCloseTo(0.143, 3);
  });
  it("KWが0件なら null（0%と未登録を区別する）", () => {
    expect(coverageRate(0, 0)).toBeNull();
  });
});
