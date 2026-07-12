import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * C-4 失注/成約 分析。単一集計RPC `winloss_metrics` に集約(データ増耐性・監査2026-07-12)。
 * RPCはSECURITY DEFINERだが関数内でownerスコープ(can_view_all or owner=uid)を再現するため、
 * 外部営業は自分担当分のみが集計される(RLS invoker時と同一挙動・パリティ検証済み)。
 */

export type Grouped = { key: string; count: number; amount: number };

export type WinLossData = {
  wonCount: number;
  wonAmount: number;
  lostCount: number;
  winRate: number; // won / (won+lost)
  lostByReason: Grouped[];
  lostByCompetitor: Grouped[];
  byCategory: { category: string; won: number; lost: number; winRate: number }[];
  recentLost: { id: string; name: string; account: string | null; amount: number; reason: string | null; closedAt: string | null }[];
};

type Payload = {
  won_count?: number;
  won_amount?: number;
  lost_count?: number;
  lost_by_reason?: { key: string; count: number; amount: number }[];
  lost_by_competitor?: { key: string; count: number; amount: number }[];
  by_category?: { category: string; won: number; lost: number }[];
  recent_lost?: { id: string; name: string; account: string | null; amount: number; reason: string | null; closedAt: string | null }[];
};

const num = (v: unknown) => Number(v ?? 0);

export async function getWinLossAnalysis(): Promise<WinLossData> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("winloss_metrics");
  const p = (data ?? {}) as Payload;

  const wonCount = num(p.won_count);
  const lostCount = num(p.lost_count);

  return {
    wonCount,
    wonAmount: num(p.won_amount),
    lostCount,
    winRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
    lostByReason: (p.lost_by_reason ?? []).map((r) => ({ key: r.key, count: num(r.count), amount: num(r.amount) })),
    lostByCompetitor: (p.lost_by_competitor ?? []).map((r) => ({ key: r.key, count: num(r.count), amount: num(r.amount) })),
    byCategory: (p.by_category ?? []).map((c) => ({
      category: c.category,
      won: num(c.won),
      lost: num(c.lost),
      winRate: num(c.won) + num(c.lost) > 0 ? num(c.won) / (num(c.won) + num(c.lost)) : 0,
    })),
    recentLost: (p.recent_lost ?? []).map((r) => ({
      id: r.id,
      name: r.name ?? "—",
      account: r.account ?? null,
      amount: num(r.amount),
      reason: r.reason,
      closedAt: r.closedAt,
    })),
  };
}
