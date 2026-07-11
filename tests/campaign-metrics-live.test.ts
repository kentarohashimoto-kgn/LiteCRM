/**
 * 展示会の指標が「CRM実データのライブ集計」を正本にすることの回帰テスト。
 *  - リード = leads実データ（無ければ静的）
 *  - アポ  = 展示会由来の商談(案件)数 opp_count（無ければ静的）
 *  - 成約/売上/進行中 = opportunities から集計（source_detail 橋渡し）
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

function live(over: Partial<CampaignLiveStat>): CampaignLiveStat {
  return { leads: 0, opp_count: 0, won_count: 0, won_amount: 0, open_count: 0, lost_count: 0, open_weighted: 0, ...over };
}

describe("campaignMetrics ライブ集計（展示会）", () => {
  it("受注(成約/売上/進行中)を opportunities のライブ値で正本化する", () => {
    // campaign_id 直付けの案件が無くても（[]）、ライブ集計から受注が反映される
    const c = camp({ id: "c1", cost: 316000 });
    const m = new Map<string, CampaignLiveStat>([
      ["c1", live({ leads: 910, opp_count: 31, won_count: 3, won_amount: 6000000, open_count: 15, open_weighted: 900000 })],
    ]);
    const [r] = campaignMetrics([c], [], m);
    expect(r.actualLeads).toBe(910);
    expect(r.appointments).toBe(31); // アポ = 商談(案件)数
    expect(r.oppCount).toBe(31);
    expect(r.wonCount).toBe(3);
    expect(r.wonAmount).toBe(6000000);
    expect(r.openCount).toBe(15);
    expect(r.weighted).toBe(900000);
  });

  it("リードがあり商談が0でも、アポは静的値へフォールバック（0表示を避ける）", () => {
    const c = camp({ id: "c1", actual_leads: undefined, appointments: 6 });
    const m = new Map<string, CampaignLiveStat>([["c1", live({ leads: 1994, opp_count: 0 })]]);
    const [r] = campaignMetrics([c], [], m);
    expect(r.actualLeads).toBe(1994);
    expect(r.appointments).toBe(6); // opp_count=0 → 静的6
    expect(r.wonCount).toBe(0);
    expect(r.wonAmount).toBe(0);
  });

  it("ライブ未提供なら従来どおり campaign_id 集計・静的フィールド", () => {
    const c = camp({ id: "c1", actual_leads: 500, appointments: 12 });
    const [r] = campaignMetrics([c], []);
    expect(r.actualLeads).toBe(500);
    expect(r.appointments).toBe(12);
    expect(r.oppCount).toBe(0);
  });

  it("CPA/CPO/ROI は正本化した値で再計算される", () => {
    const c = camp({ id: "c1", cost: 900000 });
    const m = new Map<string, CampaignLiveStat>([
      ["c1", live({ leads: 500, opp_count: 20, won_count: 4, won_amount: 4000000 })],
    ]);
    const [r] = campaignMetrics([c], [], m);
    expect(r.cpa).toBe(900000 / 20); // 費用 / 商談数
    expect(r.cpo).toBe(900000 / 4); // 費用 / 受注数
    expect(r.roi).toBeCloseTo((4000000 - 900000) / 900000, 6);
  });
});
