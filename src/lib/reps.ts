/** 営業別ビューのための純関数（顧客・案件・ファネル集計）。 */
import type { OppView } from "@/lib/data/select";
import { DEAL_PHASE_FUNNEL, DEAL_PHASE_MAP } from "@/lib/constants";
import { sum } from "@/lib/utils";

export interface FunnelBucket {
  phase: string;
  label: string;
  count: number;
  amount: number;
}

export interface RepFunnelResult {
  buckets: FunnelBucket[]; // 情報収集→…→見積（受注に向かう段階）
  future: { count: number; amount: number }; // 未来客
  unset: { count: number; amount: number }; // 案件予測 未設定
  won: { count: number; amount: number };
}

/** 案件予測(deal_phase)を軸にした個人/組織ファネル。openのみ段階集計、wonは別枠。 */
export function buildFunnel(opps: OppView[]): RepFunnelResult {
  const open = opps.filter((o) => o.status === "open");
  const buckets = DEAL_PHASE_FUNNEL.map((p) => {
    const list = open.filter((o) => o.deal_phase === p);
    return { phase: p, label: DEAL_PHASE_MAP[p] ?? p, count: list.length, amount: sum(list, (o) => o.amount) };
  });
  const futureList = open.filter((o) => o.deal_phase === "future");
  const unsetList = open.filter((o) => !o.deal_phase);
  const wonList = opps.filter((o) => o.status === "won");
  return {
    buckets,
    future: { count: futureList.length, amount: sum(futureList, (o) => o.amount) },
    unset: { count: unsetList.length, amount: sum(unsetList, (o) => o.amount) },
    won: { count: wonList.length, amount: sum(wonList, (o) => o.amount) },
  };
}
