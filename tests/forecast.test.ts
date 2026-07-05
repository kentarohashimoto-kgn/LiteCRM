/**
 * E-5 回帰テスト: 売上予測集計(buildForecast)。
 * commit/bestCase への受注(won)加算、weighted、目標とのギャップの計算を固定する。
 */
import { describe, expect, it } from "vitest";
import { buildForecast, summarizePeriod } from "@/lib/forecast";
import type { OppView } from "@/lib/data/select";

const base = new Date(2026, 6, 15); // 2026-07

// buildForecast が参照するフィールドのみを持つ最小オブジェクト
const baseOpp = {
  id: "x",
  status: "open",
  forecast_category: "pipeline",
  amount: 0,
  weighted: 0,
  expected_revenue_month: null,
  expected_close_date: null,
};

function o(partial: Partial<OppView>): OppView {
  return { ...baseOpp, ...partial } as unknown as OppView;
}

describe("buildForecast", () => {
  it("commit は open(commit) + won を合算する", () => {
    const opps = [
      o({ status: "open", forecast_category: "commit", amount: 100, weighted: 80, expected_close_date: "2026-07-10" }),
      o({ status: "won", forecast_category: "commit", amount: 50, weighted: 50, expected_close_date: "2026-07-20" }),
    ];
    const [july] = buildForecast(opps, [], 1, base);
    expect(july.monthKey).toBe("2026-07-01");
    expect(july.commit).toBe(150); // 100(open commit) + 50(won)
    expect(july.wonAmount).toBe(50);
    expect(july.weighted).toBe(130); // 80(open weighted) + 50(won)
  });

  it("bestCase は commit + best_case + won", () => {
    const opps = [
      o({ forecast_category: "commit", amount: 100, expected_close_date: "2026-07-01" }),
      o({ forecast_category: "best_case", amount: 60, expected_close_date: "2026-07-01" }),
      o({ status: "won", amount: 40, expected_close_date: "2026-07-01" }),
      o({ forecast_category: "pipeline", amount: 999, expected_close_date: "2026-07-01" }),
    ];
    const [july] = buildForecast(opps, [], 1, base);
    expect(july.bestCase).toBe(200); // 100 + 60 + 40 (pipelineは含まない)
    expect(july.pipeline).toBe(999);
  });

  it("計上月(expected_revenue_month)が close_date より優先される", () => {
    const opps = [
      o({ forecast_category: "commit", amount: 100, expected_close_date: "2026-07-01", expected_revenue_month: "2026-08-01" }),
    ];
    const buckets = buildForecast(opps, [], 2, base);
    expect(buckets[0].commit).toBe(0); // 7月には計上されない
    expect(buckets[1].commit).toBe(100); // 8月に計上
  });

  it("gap = bestCase - target", () => {
    const opps = [o({ forecast_category: "commit", amount: 100, expected_close_date: "2026-07-01" })];
    const targets = [{ target_month: "2026-07-01", target_amount: 300 }] as never;
    const [july] = buildForecast(opps, targets, 1, base);
    expect(july.target).toBe(300);
    expect(july.gap).toBe(100 - 300);
  });

  it("won/lost 以外の月・対象外の月は0", () => {
    const opps = [o({ status: "lost", forecast_category: "commit", amount: 100, expected_close_date: "2026-07-01" })];
    const [july] = buildForecast(opps, [], 1, base);
    expect(july.commit).toBe(0);
    expect(july.pipeline).toBe(0);
  });
});

describe("summarizePeriod", () => {
  it("バケット範囲の合計を返す", () => {
    const opps = [
      o({ forecast_category: "commit", amount: 100, expected_close_date: "2026-07-01" }),
      o({ forecast_category: "commit", amount: 200, expected_close_date: "2026-08-01" }),
    ];
    const buckets = buildForecast(opps, [], 3, base);
    const q = summarizePeriod(buckets, 0, 3, "Q1");
    expect(q.commit).toBe(300);
    expect(q.label).toBe("Q1");
  });
});
