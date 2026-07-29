import { describe, it, expect } from "vitest";
import {
  expectedValueFromClicks,
  expectedValueFromCvr,
  impactFromRevenue,
  iceScore,
  isInCooldown,
  DEFAULT_WEIGHTS,
} from "@/lib/seo/expected-value";
import { DEFAULT_RATES } from "@/lib/seo/strategy";

/**
 * 期待値換算はこの機能の中核。ここが狂うと施策の優先順位が丸ごと誤る。
 * 特に「広告のような大型案件に引きずられて1件が他を全部押し流す」のを
 * 防げているかを重点的に検証する。
 */

describe("expectedValueFromClicks", () => {
  it("追加クリックから期待売上まで一気通貫で換算する", () => {
    // +100クリック → セッション95 → 問合せ1.9 → 有効1.33 → 商談0.33 → 受注0.16件
    const v = expectedValueFromClicks(100, DEFAULT_RATES);
    expect(v.clicks).toBe(100);
    expect(v.inquiries).toBeCloseTo(1.9, 1);
    expect(v.leads).toBeCloseTo(1.33, 1);
    expect(v.revenue).toBeGreaterThan(200_000);
    expect(v.revenue).toBeLessThan(350_000);
  });

  it("負のクリックは0として扱う（マイナスの期待売上を出さない）", () => {
    expect(expectedValueFromClicks(-50, DEFAULT_RATES).revenue).toBe(0);
  });

  it("レートが上がれば期待売上も上がる", () => {
    const low = expectedValueFromClicks(100, { ...DEFAULT_RATES, inquiryCvr: 0.01 });
    const high = expectedValueFromClicks(100, { ...DEFAULT_RATES, inquiryCvr: 0.04 });
    expect(high.revenue).toBeGreaterThan(low.revenue);
  });
});

describe("expectedValueFromCvr", () => {
  it("追加流入ゼロでもCVR改善なら期待売上が出る", () => {
    const v = expectedValueFromCvr(1000, 0.012, 0.02, DEFAULT_RATES);
    expect(v.clicks).toBe(0);
    expect(v.inquiries).toBeCloseTo(8, 0);
    expect(v.revenue).toBeGreaterThan(0);
  });

  it("目標が現状以下なら0（改悪を提案しない）", () => {
    expect(expectedValueFromCvr(1000, 0.03, 0.02, DEFAULT_RATES).revenue).toBe(0);
  });
});

describe("impactFromRevenue", () => {
  it("対数スケールなので、桁違いの案件が他を押し流さない", () => {
    const small = impactFromRevenue(100_000);
    const big = impactFromRevenue(10_000_000);
    expect(big).toBeGreaterThan(small);
    // 100倍の売上差でもImpactの差は3倍以内に収まる
    expect(big / small).toBeLessThan(3);
  });
  it("0以下は0、上限は10", () => {
    expect(impactFromRevenue(0)).toBe(0);
    expect(impactFromRevenue(-1)).toBe(0);
    expect(impactFromRevenue(1e12)).toBeLessThanOrEqual(10);
  });
});

describe("iceScore", () => {
  it("同じ期待売上なら、手間が小さい施策が上に来る", () => {
    const title = iceScore(300_000, "title_meta", {});
    const article = iceScore(300_000, "new_article", {});
    expect(title.score).toBeGreaterThan(article.score);
  });

  it("戦略係数が近視眼を補正する（優先クラスタ・第1層・現フェーズ）", () => {
    const plain = iceScore(300_000, "rewrite", {});
    const strategic = iceScore(300_000, "rewrite", { priorityCluster: true, layer1: true, currentPhase: true });
    expect(strategic.score).toBeGreaterThan(plain.score);
    expect(strategic.strategyWeight).toBeCloseTo(
      DEFAULT_WEIGHTS.priorityCluster * DEFAULT_WEIGHTS.layer1 * DEFAULT_WEIGHTS.currentPhase,
      2,
    );
  });

  it("戦略係数により、期待売上が小さくても戦略に沿う施策が逆転しうる", () => {
    // 短期に効くが戦略外(¥40万) vs 戦略に沿う(¥30万)
    const offStrategy = iceScore(400_000, "rewrite", {});
    const onStrategy = iceScore(300_000, "rewrite", { priorityCluster: true, layer1: true });
    expect(onStrategy.score).toBeGreaterThan(offStrategy.score);
  });

  it("未知の施策タイプでも既定値で計算できる", () => {
    expect(iceScore(100_000, "unknown_type", {}).score).toBeGreaterThan(0);
  });

  it("実績勝率で Confidence を上書きできる（学習の反映口）", () => {
    const prior = iceScore(300_000, "rewrite", {});
    const learned = iceScore(300_000, "rewrite", {}, DEFAULT_WEIGHTS, 0.9);
    expect(learned.score).toBeGreaterThan(prior.score);
  });
});

describe("isInCooldown", () => {
  const today = "2026-07-29";

  it("一度も提案していなければ出せる", () => {
    expect(isInCooldown({ lastProposedAt: null, lastStatus: null, rejectReason: null, today })).toBe(false);
  });

  it("却下されたものは30日出さない（的外れの繰り返しを防ぐ）", () => {
    expect(
      isInCooldown({ lastProposedAt: "2026-07-20", lastStatus: "rejected", rejectReason: "not_relevant", today }),
    ).toBe(true);
    expect(
      isInCooldown({ lastProposedAt: "2026-06-01", lastStatus: "rejected", rejectReason: "not_relevant", today }),
    ).toBe(false);
  });

  it("「今はやらない」なら7日で再提案できる", () => {
    expect(isInCooldown({ lastProposedAt: "2026-07-25", lastStatus: "rejected", rejectReason: "not_now", today })).toBe(
      true,
    );
    expect(isInCooldown({ lastProposedAt: "2026-07-15", lastStatus: "rejected", rejectReason: "not_now", today })).toBe(
      false,
    );
  });

  it("承認済みは効果検証が終わるまで（14日）再提案しない", () => {
    expect(isInCooldown({ lastProposedAt: "2026-07-25", lastStatus: "approved", rejectReason: null, today })).toBe(true);
    expect(isInCooldown({ lastProposedAt: "2026-07-01", lastStatus: "approved", rejectReason: null, today })).toBe(
      false,
    );
  });

  it("未承認で溜まっているものは3日は再作成しない", () => {
    expect(
      isInCooldown({ lastProposedAt: "2026-07-28", lastStatus: "pending_review", rejectReason: null, today }),
    ).toBe(true);
  });
});
