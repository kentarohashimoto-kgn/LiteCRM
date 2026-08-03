import { describe, it, expect, afterEach } from "vitest";
import {
  byCompanyMonth,
  byModel,
  byMonth,
  formatUsd,
  momChange,
  monthBounds,
  monthKey,
  monthLabel,
  recentMonths,
  totalsFor,
  type UsageDailyRow,
} from "@/lib/ai-lab/usage-report";

const ORIG_PRICES = process.env.AILAB_PRICES;
afterEach(() => {
  if (ORIG_PRICES === undefined) delete process.env.AILAB_PRICES;
  else process.env.AILAB_PRICES = ORIG_PRICES;
});

function row(partial: Partial<UsageDailyRow> & { date: string }): UsageDailyRow {
  return {
    model_key: "claude-sonnet",
    requests: 1,
    input_tokens: 0,
    output_tokens: 0,
    images: 0,
    ...partial,
  };
}

describe("月キーの扱い", () => {
  it("日付から年月を取り出す", () => {
    expect(monthKey("2026-08-03")).toBe("2026-08");
    expect(monthKey("2026-12-31")).toBe("2026-12");
  });

  it("壊れた日付は空文字（集計から落とす）", () => {
    expect(monthKey("")).toBe("");
    expect(monthKey("not-a-date")).toBe("");
    expect(monthKey(undefined as unknown as string)).toBe("");
  });

  it("表示用ラベルに変換する", () => {
    expect(monthLabel("2026-08")).toBe("2026年8月");
    expect(monthLabel("2026-12")).toBe("2026年12月");
    expect(monthLabel("こわれた")).toBe("こわれた");
  });

  it("月の初日・末日を返す（月末とうるう年を含む）", () => {
    expect(monthBounds("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("直近Nか月を古い順に返し、年をまたいでも連続する", () => {
    expect(recentMonths(3, new Date(2026, 7, 15))).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(recentMonths(3, new Date(2026, 0, 15))).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(recentMonths(12, new Date(2026, 7, 15))).toHaveLength(12);
  });
});

describe("合計の算出", () => {
  it("トークン・リクエスト・画像を合算し、合計トークンを出す", () => {
    const t = totalsFor([
      row({ date: "2026-08-01", input_tokens: 100, output_tokens: 200, requests: 2, images: 1 }),
      row({ date: "2026-08-02", input_tokens: 50, output_tokens: 25, requests: 1, images: 0 }),
    ]);
    expect(t.inputTokens).toBe(150);
    expect(t.outputTokens).toBe(225);
    expect(t.totalTokens).toBe(375);
    expect(t.requests).toBe(3);
    expect(t.images).toBe(1);
  });

  it("空配列でもゼロで返す（例外にしない）", () => {
    const t = totalsFor([]);
    expect(t.totalTokens).toBe(0);
    expect(t.usd).toBe(0);
    expect(t.costComplete).toBe(true);
  });

  it("標準価格からコストを出す", () => {
    delete process.env.AILAB_PRICES;
    const t = totalsFor([
      row({ date: "2026-08-01", model_key: "claude-sonnet", input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ]);
    expect(t.usd).toBeCloseTo(18, 6);
    expect(t.costComplete).toBe(true);
  });

  it("画像生成が混ざるとコストは不完全と申告する", () => {
    delete process.env.AILAB_PRICES;
    const t = totalsFor([row({ date: "2026-08-01", model_key: "image-gen", output_tokens: 10, images: 3 })]);
    expect(t.costComplete).toBe(false);
  });
});

describe("月別推移", () => {
  const rows = [
    row({ date: "2026-06-10", input_tokens: 100, output_tokens: 100 }),
    row({ date: "2026-08-01", input_tokens: 500, output_tokens: 500 }),
    row({ date: "2026-08-20", input_tokens: 200, output_tokens: 100 }),
  ];

  it("指定した月は利用が無くてもゼロ行として残す（グラフが歯抜けにならない）", () => {
    const series = byMonth(rows, ["2026-06", "2026-07", "2026-08"]);
    expect(series.map((p) => p.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(series[1].totalTokens).toBe(0);
  });

  it("同じ月の行を合算する", () => {
    const series = byMonth(rows, ["2026-08"]);
    expect(series[0].totalTokens).toBe(1300);
    expect(series[0].requests).toBe(2);
  });

  it("対象月の外にある行は取り込まない", () => {
    const series = byMonth(rows, ["2026-07"]);
    expect(series[0].totalTokens).toBe(0);
  });

  it("表示ラベルが入る", () => {
    expect(byMonth([], ["2026-08"])[0].label).toBe("2026年8月");
  });
});

describe("会社 × 月のマトリクス", () => {
  const rows = [
    row({ date: "2026-07-05", company_id: "A", input_tokens: 10, output_tokens: 10 }),
    row({ date: "2026-08-05", company_id: "A", input_tokens: 100, output_tokens: 100 }),
    row({ date: "2026-08-06", company_id: "B", input_tokens: 5, output_tokens: 5 }),
  ];

  it("会社ごと・月ごとに振り分ける", () => {
    const m = byCompanyMonth(rows, ["2026-07", "2026-08"], ["A", "B"]);
    expect(m.A["2026-07"].totalTokens).toBe(20);
    expect(m.A["2026-08"].totalTokens).toBe(200);
    expect(m.B["2026-07"].totalTokens).toBe(0);
    expect(m.B["2026-08"].totalTokens).toBe(10);
  });

  it("利用が1件も無い会社もゼロ埋めして返す", () => {
    const m = byCompanyMonth(rows, ["2026-08"], ["A", "B", "C"]);
    expect(m.C["2026-08"].totalTokens).toBe(0);
  });

  it("会社が別なら同じ月でも混ざらない", () => {
    const m = byCompanyMonth(rows, ["2026-08"], ["A"]);
    expect(m.A["2026-08"].totalTokens).toBe(200); // B の 10 を含まない
  });
});

describe("モデル別の内訳", () => {
  it("トークンの多い順に並べる", () => {
    const breakdown = byModel([
      row({ date: "2026-08-01", model_key: "claude-haiku", input_tokens: 10, output_tokens: 10 }),
      row({ date: "2026-08-01", model_key: "claude-opus", input_tokens: 500, output_tokens: 500 }),
      row({ date: "2026-08-02", model_key: "claude-haiku", input_tokens: 5, output_tokens: 5 }),
    ]);
    expect(breakdown.map((b) => b.modelKey)).toEqual(["claude-opus", "claude-haiku"]);
    expect(breakdown[1].totals.totalTokens).toBe(30);
  });

  it("空配列なら空を返す", () => {
    expect(byModel([])).toEqual([]);
  });
});

describe("前月比とコスト表示", () => {
  it("増減率を出す", () => {
    expect(momChange(150, 100)).toBeCloseTo(0.5);
    expect(momChange(50, 100)).toBeCloseTo(-0.5);
    expect(momChange(100, 100)).toBe(0);
  });

  it("前月が0なら比較できないので null", () => {
    expect(momChange(100, 0)).toBeNull();
    expect(momChange(0, 0)).toBeNull();
  });

  it("コストは小数2桁で表示する", () => {
    expect(formatUsd(12.3456)).toBe("$12.35");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
