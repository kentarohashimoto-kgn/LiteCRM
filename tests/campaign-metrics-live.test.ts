/**
 * 展示会のリード/アポが「ライブ集計」を優先し、無い場合のみ静的値へフォールバックすることの回帰テスト。
 */
import { describe, expect, it } from "vitest";
import { campaignMetrics, type CampaignLiveStat } from "@/lib/analytics";
import type { Campaign } from "@/lib/types";

function camp(over: Partial<Campaign>): Campaign {
  return {
    id: "c1",
    tenant_id: "t1",
    channel: "exhibition",
    name: "AI NATIVE EXPO 2026",
    event_status: "planned",
    status: "active",
    created_at: "2026-06-01",
    ...over,
  } as Campaign;
}

describe("campaignMetrics ライブ集計", () => {
  it("ライブ値が正ならリード/アポはライブを採用（静的値を上書き）", () => {
    const c = camp({ id: "c1", actual_leads: undefined, appointments: 6 });
    const live = new Map<string, CampaignLiveStat>([["c1", { leads: 1994, appts: 0 }]]);
    const [m] = campaignMetrics([c], [], live);
    expect(m.actualLeads).toBe(1994); // 静的null → ライブ1994
    expect(m.appointments).toBe(6); // ライブ0 → 静的6へフォールバック
  });

  it("ライブのアポが正ならアポもライブを採用", () => {
    const c = camp({ id: "c1", actual_leads: 926, appointments: 22 });
    const live = new Map<string, CampaignLiveStat>([["c1", { leads: 910, appts: 26 }]]);
    const [m] = campaignMetrics([c], [], live);
    expect(m.actualLeads).toBe(910);
    expect(m.appointments).toBe(26);
  });

  it("ライブ未提供なら従来どおり静的フィールド", () => {
    const c = camp({ id: "c1", actual_leads: 500, appointments: 12 });
    const [m] = campaignMetrics([c], []);
    expect(m.actualLeads).toBe(500);
    expect(m.appointments).toBe(12);
  });

  it("ライブに該当campaignが無ければ静的フィールドへフォールバック", () => {
    const c = camp({ id: "c1", actual_leads: 500, appointments: 12 });
    const live = new Map<string, CampaignLiveStat>([["other", { leads: 100, appts: 5 }]]);
    const [m] = campaignMetrics([c], [], live);
    expect(m.actualLeads).toBe(500);
    expect(m.appointments).toBe(12);
  });

  it("CPL/CPAはライブのリード/アポで再計算される", () => {
    const c = camp({ id: "c1", cost: 1000000, actual_leads: 100, appointments: 10 });
    const live = new Map<string, CampaignLiveStat>([["c1", { leads: 2000, appts: 40 }]]);
    const [m] = campaignMetrics([c], [], live);
    expect(m.cpl).toBe(1000000 / 2000); // 500
    expect(m.cpa).toBe(1000000 / 40); // 25000
  });
});
