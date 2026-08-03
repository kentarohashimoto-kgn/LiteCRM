import { describe, it, expect } from "vitest";
import {
  RATE_LIMIT_IMAGE_PER_MIN,
  RATE_LIMIT_TEXT_PER_MIN,
  budgetRatio,
  isBudgetExceeded,
  isRateLimited,
  labErrorMessage,
  monthRange,
  sumTokens,
  sumUsage,
} from "@/lib/ai-lab/limits";

describe("レート制限", () => {
  it("テキストは1分10件、画像は1分3件で止まる", () => {
    expect(isRateLimited(RATE_LIMIT_TEXT_PER_MIN - 1, "text")).toBe(false);
    expect(isRateLimited(RATE_LIMIT_TEXT_PER_MIN, "text")).toBe(true);
    expect(isRateLimited(RATE_LIMIT_IMAGE_PER_MIN - 1, "image")).toBe(false);
    expect(isRateLimited(RATE_LIMIT_IMAGE_PER_MIN, "image")).toBe(true);
  });
});

describe("月間トークン予算", () => {
  it("予算未満は許可、同数・超過は拒否", () => {
    expect(isBudgetExceeded(999, 1000)).toBe(false);
    expect(isBudgetExceeded(1000, 1000)).toBe(true);
    expect(isBudgetExceeded(1001, 1000)).toBe(true);
  });

  it("予算 null(無制限)は常に許可", () => {
    expect(isBudgetExceeded(10_000_000, null)).toBe(false);
    expect(isBudgetExceeded(0, undefined)).toBe(false);
  });

  it("消化率は無制限なら null", () => {
    expect(budgetRatio(500, 1000)).toBeCloseTo(0.5);
    expect(budgetRatio(500, null)).toBeNull();
    expect(budgetRatio(500, 0)).toBeNull();
  });
});

describe("集計期間", () => {
  it("当月の初日と末日を YYYY-MM-DD で返す", () => {
    expect(monthRange(new Date(2026, 7, 3))).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthRange(new Date(2026, 1, 15))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // うるう年
    expect(monthRange(new Date(2028, 1, 15))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("利用量の集計", () => {
  const rows = [
    { input_tokens: 100, output_tokens: 200, requests: 1, images: 0 },
    { input_tokens: 50, output_tokens: 25, requests: 2, images: 3 },
  ];

  it("トークンは入出力を合算する", () => {
    expect(sumTokens(rows)).toBe(375);
    expect(sumTokens([])).toBe(0);
  });

  it("リクエスト数・画像枚数もまとめて出す", () => {
    expect(sumUsage(rows)).toEqual({ inputTokens: 150, outputTokens: 225, requests: 3, images: 3 });
  });
});

describe("エラー文言", () => {
  it("原因ごとに、次の行動が分かる日本語を返す", () => {
    expect(labErrorMessage("budget_exceeded")).toContain("利用上限");
    expect(labErrorMessage("rate_limited")).toContain("1分");
    expect(labErrorMessage("model_not_allowed")).toContain("別のモデル");
  });

  it("未知のコード・null は汎用のエラー文言にフォールバックする", () => {
    expect(labErrorMessage("something-new")).toBe(labErrorMessage("provider_error"));
    expect(labErrorMessage(null)).toBe(labErrorMessage("provider_error"));
  });
});
