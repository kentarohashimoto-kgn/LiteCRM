/** 展示会分析のデータ取得(RPC exhibition_breakdown)。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ExhibitionRow } from "@/lib/exhibition-analysis";

export async function getExhibitionBreakdown(start: string, end: string): Promise<ExhibitionRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("exhibition_breakdown", { p_start: start, p_end: end });
  return (data ?? []) as ExhibitionRow[];
}
