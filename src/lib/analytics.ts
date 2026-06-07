/**
 * 分析ロジック(要件 10章)。営業マン別 / 商品別 / 流入経路別。
 */

import type { OppView } from "@/lib/data/select";
import type { Lead } from "@/lib/types";
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
  wonCount: number;
  wonAmount: number;
  winRate: number; // won / opp
  avgDealSize: number;
}

export function channelMetrics(opps: OppView[], leads: Lead[]): ChannelMetric[] {
  const oppBySource = groupBy(
    opps.filter((o) => o.lead_source_id),
    (o) => o.lead_source_id!,
  );
  const leadBySource = groupBy(
    leads.filter((l) => l.lead_source_id),
    (l) => l.lead_source_id!,
  );
  const sourceIds = new Set([...Object.keys(oppBySource), ...Object.keys(leadBySource)]);

  return Array.from(sourceIds)
    .map((sourceId) => {
      const list = oppBySource[sourceId] ?? [];
      const leadList = leadBySource[sourceId] ?? [];
      const won = list.filter((o) => o.status === "won");
      const name = list[0]?.leadSource?.name ?? "—";
      return {
        sourceId,
        name,
        leadCount: leadList.length,
        oppCount: list.length,
        conversionRate: leadList.length ? list.length / leadList.length : 0,
        wonCount: won.length,
        wonAmount: sum(won, (o) => o.amount),
        winRate: list.length ? won.length / list.length : 0,
        avgDealSize: won.length ? sum(won, (o) => o.amount) / won.length : 0,
      };
    })
    .sort((a, b) => b.wonAmount - a.wonAmount);
}
