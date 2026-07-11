/**
 * 分析ロジック(要件 10章)。営業マン別 / 商品別 / 流入経路別。
 */

import type { OppView } from "@/lib/data/select";
import type { Campaign } from "@/lib/types";
import { groupBy, sum } from "@/lib/utils";
import { isStale, noNextAction } from "@/lib/risk";

export interface RepMetric {
  userId: string;
  name: string;
  openCount: number;
  openAmount: number;
  wonCount: number;
  wonAmount: number;
  lostCount: number;
  winRate: number; // won / (won + lost)
  avgDealSize: number;
  weighted: number;
  staleCount: number;
  noNextActionCount: number;
  nextActionRate: number; // open with next action / open
}

export function repMetrics(opps: OppView[]): RepMetric[] {
  const byOwner = groupBy(opps, (o) => o.owner_user_id);
  return Object.entries(byOwner)
    .map(([userId, list]) => {
      const open = list.filter((o) => o.status === "open");
      const won = list.filter((o) => o.status === "won");
      const lost = list.filter((o) => o.status === "lost");
      const decided = won.length + lost.length;
      const withNext = open.filter((o) => o.next_action_date).length;
      return {
        userId,
        name: list[0].owner?.name ?? "—",
        openCount: open.length,
        openAmount: sum(open, (o) => o.amount),
        wonCount: won.length,
        wonAmount: sum(won, (o) => o.amount),
        lostCount: lost.length,
        winRate: decided ? won.length / decided : 0,
        avgDealSize: won.length ? sum(won, (o) => o.amount) / won.length : 0,
        weighted: sum(open, (o) => o.weighted),
        staleCount: open.filter((o) => isStale(o)).length,
        noNextActionCount: open.filter((o) => noNextAction(o)).length,
        nextActionRate: open.length ? withNext / open.length : 1,
      };
    })
    .sort((a, b) => b.wonAmount - a.wonAmount);
}

export interface ProductMetric {
  productId: string;
  name: string;
  category?: string;
  oppCount: number;
  openAmount: number;
  wonCount: number;
  wonAmount: number;
  lostCount: number;
  winRate: number;
  avgDealSize: number;
  grossProfit: number;
}

export function productMetrics(opps: OppView[]): ProductMetric[] {
  const withProduct = opps.filter((o) => o.primary_product_id);
  const byProduct = groupBy(withProduct, (o) => o.primary_product_id!);
  return Object.entries(byProduct)
    .map(([productId, list]) => {
      const won = list.filter((o) => o.status === "won");
      const lost = list.filter((o) => o.status === "lost");
      const open = list.filter((o) => o.status === "open");
      const decided = won.length + lost.length;
      return {
        productId,
        name: list[0].product?.name ?? "—",
        category: list[0].product?.category,
        oppCount: list.length,
        openAmount: sum(open, (o) => o.amount),
        wonCount: won.length,
        wonAmount: sum(won, (o) => o.amount),
        lostCount: lost.length,
        winRate: decided ? won.length / decided : 0,
        avgDealSize: won.length ? sum(won, (o) => o.amount) / won.length : 0,
        grossProfit: sum(won, (o) => o.gross_profit ?? 0),
      };
    })
    .sort((a, b) => b.wonAmount - a.wonAmount);
}

export interface ChannelMetric {
  sourceId: string;
  name: string;
  leadCount: number;
  oppCount: number;
  conversionRate: number; // opp / lead
  openCount: number;
  openAmount: number;
  weighted: number; // 進行中の加重パイプライン
  wonCount: number;
  wonAmount: number;
  lostCount: number;
  winRate: number; // won / (won + lost)
  avgDealSize: number;
}

/**
 * 施策インスタンス(展示会など)別の指標。
 * リード数・アポ数・費用は施策側の実績(campaign)を、成約数・売上はCRM商談を正本とする。
 */
export interface CampaignMetric {
  campaign: Campaign;
  oppCount: number; // CRM紐付き商談数
  openCount: number;
  wonCount: number; // 成約数(CRM=正本)
  lostCount: number;
  wonAmount: number; // 売上(CRM=正本)
  weighted: number; // 進行中の加重パイプライン
  actualLeads: number | null;
  appointments: number | null;
  expectedLeads: number | null;
  cost: number | null;
  cpl: number | null; // 費用 / リード数
  cpa: number | null; // 費用 / アポ数
  cpo: number | null; // 費用 / 成約数(CRM)
  roi: number | null; // (売上 - 費用) / 費用
  apptRate: number | null; // アポ数 / リード数
  winRate: number | null; // 成約数 / アポ数
}

/** 展示会などの「ライブ実績」（leadsテーブルから集計したリード/アポ）。campaign_id 別。 */
export interface CampaignLiveStat {
  leads: number;
  appts: number;
}

/**
 * 施策別の指標を算出。
 * live を渡すと、リード数・アポ数は「ライブ集計（leads実データ）」を優先し、
 * ライブが 0（＝まだ実データが無い）の場合のみ静的フィールド(actual_leads/appointments)へフォールバックする。
 * これにより展示会のリード/アポが手入力に依存せず自動で最新化される。
 */
export function campaignMetrics(
  campaigns: Campaign[],
  opps: OppView[],
  live?: Map<string, CampaignLiveStat>,
): CampaignMetric[] {
  const byCampaign = groupBy(
    opps.filter((o) => o.campaign_id),
    (o) => o.campaign_id!,
  );
  return campaigns.map((c) => {
    const list = byCampaign[c.id] ?? [];
    const won = list.filter((o) => o.status === "won");
    const open = list.filter((o) => o.status === "open");
    const lost = list.filter((o) => o.status === "lost");
    const wonAmount = sum(won, (o) => o.amount);
    const cost = c.cost ?? null;
    const ls = live?.get(c.id);
    // ライブ値が正なら最新のリード/アポとして採用。無ければ従来の静的フィールド。
    const actualLeads = (ls && ls.leads > 0 ? ls.leads : c.actual_leads) ?? null;
    const appts = (ls && ls.appts > 0 ? ls.appts : c.appointments) ?? null;
    return {
      campaign: c,
      oppCount: list.length,
      openCount: open.length,
      wonCount: won.length,
      lostCount: lost.length,
      wonAmount,
      weighted: sum(open, (o) => o.weighted),
      actualLeads,
      appointments: appts,
      expectedLeads: c.expected_leads ?? null,
      cost,
      cpl: cost != null && actualLeads ? cost / actualLeads : null,
      cpa: cost != null && appts ? cost / appts : null,
      cpo: cost != null && won.length ? cost / won.length : null,
      roi: cost != null && cost > 0 ? (wonAmount - cost) / cost : null,
      apptRate: actualLeads && appts != null ? appts / actualLeads : null,
      winRate: appts ? won.length / appts : null,
    };
  });
}

export interface CampaignTotals {
  count: number;
  leads: number;
  appointments: number;
  oppCount: number;
  wonCount: number;
  wonAmount: number;
  weighted: number;
  cost: number;
  cpl: number | null;
  cpa: number | null;
  cpo: number | null;
  roi: number | null;
}

export function campaignTotals(metrics: CampaignMetric[]): CampaignTotals {
  const leads = sum(metrics, (m) => m.actualLeads ?? 0);
  const appointments = sum(metrics, (m) => m.appointments ?? 0);
  const wonCount = sum(metrics, (m) => m.wonCount);
  const wonAmount = sum(metrics, (m) => m.wonAmount);
  const cost = sum(metrics, (m) => m.cost ?? 0);
  return {
    count: metrics.length,
    leads,
    appointments,
    oppCount: sum(metrics, (m) => m.oppCount),
    wonCount,
    wonAmount,
    weighted: sum(metrics, (m) => m.weighted),
    cost,
    cpl: leads ? cost / leads : null,
    cpa: appointments ? cost / appointments : null,
    cpo: wonCount ? cost / wonCount : null,
    roi: cost > 0 ? (wonAmount - cost) / cost : null,
  };
}

export function channelMetrics(opps: OppView[], leadCountBySource: Map<string, number>): ChannelMetric[] {
  const oppBySource = groupBy(
    opps.filter((o) => o.lead_source_id),
    (o) => o.lead_source_id!,
  );
  const sourceIds = new Set([...Object.keys(oppBySource), ...leadCountBySource.keys()]);

  return Array.from(sourceIds)
    .map((sourceId) => {
      const list = oppBySource[sourceId] ?? [];
      const won = list.filter((o) => o.status === "won");
      const open = list.filter((o) => o.status === "open");
      const lost = list.filter((o) => o.status === "lost");
      const decided = won.length + lost.length;
      const name = list[0]?.leadSource?.name ?? "—";
      const leadCount = leadCountBySource.get(sourceId) ?? 0;
      return {
        sourceId,
        name,
        leadCount,
        oppCount: list.length,
        conversionRate: leadCount ? list.length / leadCount : 0,
        openCount: open.length,
        openAmount: sum(open, (o) => o.amount),
        weighted: sum(open, (o) => o.weighted),
        wonCount: won.length,
        wonAmount: sum(won, (o) => o.amount),
        lostCount: lost.length,
        winRate: decided ? won.length / decided : 0,
        avgDealSize: won.length ? sum(won, (o) => o.amount) / won.length : 0,
      };
    })
    .sort((a, b) => b.wonAmount - a.wonAmount);
}
