import { describe, it, expect } from "vitest";
import { safeRate, rateHealth, chainRates, diagnose, prescriptions, type XrayPeriod } from "@/lib/xray";

function period(over: Partial<XrayPeriod>): XrayPeriod {
  return {
    leads: 0, appts: 0, meets: 0, won: 0, revenue: 0,
    st_resched: 0, st_cancel: 0, st_pending: 0, st_appt: 0,
    won_booked: 0, revenue_booked: 0, revenue_exist: 0,
    fu_due: 0, fu_held: 0, fu_proposals: 0, fu_upsell: 0,
    ...over,
  };
}

describe("safeRate", () => {
  it("分母0はnull(ゼロ除算ガード)", () => {
    expect(safeRate(5, 0)).toBeNull();
    expect(safeRate(5, 10)).toBe(0.5);
  });
});

describe("rateHealth", () => {
  it("-10%以内はgood / -25%以内はwarn / それ超はbad", () => {
    expect(rateHealth(0.095, 0.1, 100)).toBe("good");   // -5%
    expect(rateHealth(0.08, 0.1, 100)).toBe("warn");    // -20%
    expect(rateHealth(0.05, 0.1, 100)).toBe("bad");     // -50%
    expect(rateHealth(0.12, 0.1, 100)).toBe("good");    // 改善
  });
  it("分母不足・基準なしはna(誤診防止)", () => {
    expect(rateHealth(0.05, 0.1, 3)).toBe("na");        // denom < MIN_DENOM
    expect(rateHealth(0.05, null, 100)).toBe("na");
    expect(rateHealth(null, 0.1, 100)).toBe("na");
  });
});

describe("chainRates", () => {
  it("各率を連鎖カウントから計算", () => {
    const r = chainRates(period({ leads: 1000, appts: 100, meets: 80, won: 8, revenue: 8_000_000 }));
    expect(r.apptRate).toBeCloseTo(0.1);
    expect(r.meetRate).toBeCloseTo(0.8);
    expect(r.winRate).toBeCloseTo(0.1);
    expect(r.avgPrice).toBeCloseTo(1_000_000);
  });
});

describe("diagnose: 機会損失(impact)", () => {
  // cur: 1000 × 10% × 80% × 10% × ¥1M = ¥8M
  const cur = period({ leads: 1000, appts: 100, meets: 80, won: 8, revenue: 8_000_000 });
  // cmp: アポ率15%だけ良かった期間
  const cmp = period({ leads: 1000, appts: 150, meets: 120, won: 12, revenue: 12_000_000 });

  it("悪化した率を基準に戻した売上増を計算する", () => {
    const nodes = diagnose(cur, cmp);
    const appt = nodes.find((n) => n.key === "apptRate")!;
    // 復元後: 1000×0.15×0.8×0.1×1M = ¥12M → +¥4M
    expect(appt.impact).toBe(4_000_000);
    expect(appt.health).toBe("bad"); // 0.10 vs 0.15 = -33%
  });

  it("悪化していないノードのimpactは0", () => {
    const nodes = diagnose(cur, cmp);
    // meetRate: cur 0.8 vs cmp 0.8 → 差なし
    expect(nodes.find((n) => n.key === "meetRate")!.impact).toBe(0);
    expect(nodes.find((n) => n.key === "avgPrice")!.impact).toBe(0);
  });

  it("リード減少は件数差×下流の率で換算", () => {
    const cur2 = period({ leads: 500, appts: 50, meets: 40, won: 4, revenue: 4_000_000 });
    const cmp2 = period({ leads: 1000, appts: 100, meets: 80, won: 8, revenue: 8_000_000 });
    const nodes = diagnose(cur2, cmp2);
    const leads = nodes.find((n) => n.key === "leads")!;
    // 率は同一、リードだけ半減 → 復元で+¥4M
    expect(leads.impact).toBe(4_000_000);
  });

  it("分母0でもクラッシュしない(全ゼロ期間)", () => {
    const nodes = diagnose(period({}), period({}));
    expect(nodes).toHaveLength(5);
    for (const n of nodes) {
      expect(n.health).toBe("na");
      expect(n.impact).toBe(0);
    }
  });
});

describe("prescriptions", () => {
  it("機会損失の大きい順に最大3件", () => {
    const cur = period({ leads: 500, appts: 25, meets: 15, won: 1, revenue: 800_000 });
    const cmp = period({ leads: 1000, appts: 100, meets: 80, won: 8, revenue: 8_000_000 });
    const rx = prescriptions(diagnose(cur, cmp), cur);
    expect(rx.length).toBeLessThanOrEqual(3);
    expect(rx.length).toBeGreaterThan(0);
    // 降順ソートの検証
    for (let i = 1; i < rx.length; i++) {
      if (rx[i - 1].impact > 0 && rx[i].impact > 0) {
        expect(rx[i - 1].impact).toBeGreaterThanOrEqual(rx[i].impact);
      }
    }
  });

  it("FU未消化を検知する(期間比較に依存しない処方)", () => {
    const cur = period({ leads: 100, appts: 10, meets: 8, won: 2, revenue: 2_000_000, fu_due: 10, fu_held: 0 });
    const rx = prescriptions(diagnose(cur, cur), cur); // 前期比フラット→率系の処方なし
    expect(rx.some((p) => p.key === "fu")).toBe(true);
  });

  it("滞留(リスケ+調整中)がアポの15%以上で警告", () => {
    const cur = period({ leads: 100, appts: 20, meets: 10, won: 2, revenue: 2_000_000, st_resched: 2, st_pending: 2 });
    const rx = prescriptions(diagnose(cur, cur), cur);
    expect(rx.some((p) => p.key === "stalled")).toBe(true);
  });
});
