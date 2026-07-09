import { describe, it, expect } from "vitest";
import {
  cellCost,
  computeCellCost,
  effectivePM,
  assignmentCost,
  assignmentEffortMM,
  grossRate,
  rollup,
  minPrice,
  discountRoom,
  proposalVerdict,
  costVariance,
  estimateAtCompletion,
  round,
  type Assignment,
  type RevenueCell,
} from "@/lib/project-cost";

// 単位は万円（ロジックは単位非依存）。定義書のワークシート例を検証する。
// コンサルA: 100万/人月, 8月0.5人月×稼働50% / 9月0.5 / 10月0.5
// エンジニアB: 80万/人月, 9月0.5 / 10月0.5
const consultA: Assignment = {
  id: "a", label: "コンサルA", costRate: 100,
  cells: [
    { month: "2026-08", manMonth: 0.5, ratio: 0.5 },
    { month: "2026-09", manMonth: 0.5, ratio: 1 },
    { month: "2026-10", manMonth: 0.5, ratio: 1 },
  ],
};
const engineerB: Assignment = {
  id: "b", label: "エンジニアB", costRate: 80,
  cells: [
    { month: "2026-09", manMonth: 0.5, ratio: 1 },
    { month: "2026-10", manMonth: 0.5, ratio: 1 },
  ],
};
const revenue: RevenueCell[] = [
  { month: "2026-08", amount: 100 },
  { month: "2026-09", amount: 100 },
  { month: "2026-10", amount: 100 },
];

describe("cellCost（月途中の稼働率按分）", () => {
  it("中旬開始は稼働率50%で半分になる", () => {
    expect(cellCost(100, 0.5, 0.5)).toBe(25); // 8月コンサルA
    expect(cellCost(100, 0.5, 1)).toBe(50); // フル稼働
    expect(cellCost(80, 0.5, 1)).toBe(40); // エンジニアB
  });
  it("負値・NaNは0に丸める", () => {
    expect(cellCost(-100, 1, 1)).toBe(0);
    expect(cellCost(100, NaN, 1)).toBe(0);
  });
});

describe("単価種別×工数記述の4通り(computeCellCost)", () => {
  // 標準160h/人月。人月100万 ⇔ 時給6,250円。0.5人月 ⇔ 80h。
  it("人月単価 × 率(既定)", () => {
    expect(computeCellCost({ costRate: 100, manMonth: 0.5, ratio: 1 })).toBe(50);
  });
  it("時給 × 時間: 時給6250円 × 80h = 50万", () => {
    expect(computeCellCost({ costRate: 6250, rateUnit: "hourly", effortUnit: "hours", hours: 80 })).toBe(500000);
  });
  it("人月単価 × 時間: 人月100万・80h/160h = 0.5人月 → 50万", () => {
    expect(computeCellCost({ costRate: 100, rateUnit: "man_month", effortUnit: "hours", hours: 80, hoursPerMonth: 160 })).toBe(50);
  });
  it("時給 × 率: 時給6250円・0.5人月=80h → 50万", () => {
    expect(computeCellCost({ costRate: 6250, rateUnit: "hourly", effortUnit: "ratio", manMonth: 0.5, ratio: 1, hoursPerMonth: 160 })).toBe(500000);
  });
  it("hoursPerMonthを変えると人月換算が変わる(140h/人月)", () => {
    expect(computeCellCost({ costRate: 140, rateUnit: "man_month", effortUnit: "hours", hours: 140, hoursPerMonth: 140 })).toBe(140);
  });
  it("effectivePM: 時間モードは時間÷H", () => {
    expect(effectivePM({ month: "", hours: 80 }, "hours", 160)).toBe(0.5);
    expect(effectivePM({ month: "", manMonth: 0.5, ratio: 0.5 }, "ratio")).toBe(0.25);
  });
});

describe("assignmentCost / effort", () => {
  it("数ヶ月案件は各月を合算（コンサルAは25+50+50=125万）", () => {
    expect(assignmentCost(consultA)).toBe(125);
    expect(assignmentCost(engineerB)).toBe(80);
  });
  it("実効人月は稼働率換算（コンサルA=0.25+0.5+0.5=1.25人月）", () => {
    expect(assignmentEffortMM(consultA)).toBe(1.25);
  });
});

describe("rollup（月別の販売・原価・粗利）", () => {
  const r = rollup([consultA, engineerB], revenue);
  it("月別原価は 25 / 90 / 90 万", () => {
    expect(r.months.map((m) => m.cost)).toEqual([25, 90, 90]);
  });
  it("月別粗利は 75 / 10 / 10 万", () => {
    expect(r.months.map((m) => m.gross)).toEqual([75, 10, 10]);
  });
  it("月別粗利率（8月75% / 9月10% / 10月10%）", () => {
    expect(r.months.map((m) => round(m.grossRate, 3))).toEqual([0.75, 0.1, 0.1]);
  });
  it("合計は 販売300 / 原価205 / 粗利95 / 率31.7%", () => {
    expect(r.totals.revenue).toBe(300);
    expect(r.totals.cost).toBe(205);
    expect(r.totals.gross).toBe(95);
    expect(round(r.totals.grossRate, 3)).toBe(0.317);
  });
  it("月は昇順に並ぶ", () => {
    expect(r.months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

describe("grossRate（0除算ガード）", () => {
  it("販売0なら0", () => {
    expect(grossRate(0, 50)).toBe(0);
  });
});

describe("minPrice / discountRoom（値引き許容）", () => {
  it("下限価格 = 原価 ÷ (1 − 最低粗利率)", () => {
    expect(round(minPrice(205, 0.25), 2)).toBe(273.33);
  });
  it("定価300・原価205・最低25% → 値引き余地 約26.7万(8.9%)", () => {
    const d = discountRoom(300, 205, 0.25);
    expect(round(d.minPrice, 2)).toBe(273.33);
    expect(round(d.roomAmount, 2)).toBe(26.67);
    expect(round(d.roomPct, 3)).toBe(0.089);
  });
  it("最低粗利率が不正（0以下）なら原価が下限", () => {
    expect(minPrice(200, 0)).toBe(200);
  });
});

describe("proposalVerdict（提案可否ゲート）", () => {
  it("既定しきい値: ≥40% GO / 25-40% 条件付き / <25% 要協議", () => {
    expect(proposalVerdict({ grossRate: 0.45 })).toBe("go");
    expect(proposalVerdict({ grossRate: 0.317 })).toBe("conditional");
    expect(proposalVerdict({ grossRate: 0.2 })).toBe("review");
  });
  it("高リスク/本部関与大は1段階シビアに（GO→条件付き, 条件付き→要協議）", () => {
    expect(proposalVerdict({ grossRate: 0.5, risk: "high" })).toBe("conditional");
    expect(proposalVerdict({ grossRate: 0.317, involvement: "high" })).toBe("review");
  });
  it("低リスクなら引き下げなし", () => {
    expect(proposalVerdict({ grossRate: 0.5, risk: "low", involvement: "low" })).toBe("go");
  });
});

describe("costVariance（予実差異：少ないほど良い指標）", () => {
  it("計画90・実績104 → 超過(+14, over)", () => {
    const v = costVariance(90, 104);
    expect(v.diff).toBe(14);
    expect(round(v.pct, 3)).toBe(0.156);
    expect(v.status).toBe("over");
  });
  it("計画内は on_track、5%以内は watch", () => {
    expect(costVariance(100, 100).status).toBe("on_track");
    expect(costVariance(100, 104).status).toBe("watch");
    expect(costVariance(100, 106).status).toBe("over");
  });
  it("計画0で実績ありは over", () => {
    expect(costVariance(0, 10).status).toBe("over");
  });
});

describe("estimateAtCompletion（EAC）", () => {
  it("実績 + 残計画 で着地原価を見積もる", () => {
    // 計画総額205、9月時点の計画消化115(=25+90)、実績消化129(=25+104)
    expect(estimateAtCompletion({ planTotalCost: 205, plannedToDate: 115, actualToDate: 129 })).toBe(219);
  });
});
