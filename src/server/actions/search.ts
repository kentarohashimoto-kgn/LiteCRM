"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export interface GlobalSearchHit {
  kind: "account" | "opportunity" | "lead";
  id: string;
  title: string;
  sub: string | null;
}

/** グローバル検索(顧客/案件/リード横断)。RPC global_search を呼ぶ。 */
export async function globalSearchAction(q: string): Promise<GlobalSearchHit[]> {
  await requireCtx();
  if (!q.trim()) return [];
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("global_search", { p_q: q.trim() });
  return (data ?? []) as GlobalSearchHit[];
}
