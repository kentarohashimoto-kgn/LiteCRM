/** 展示会分析のデータ取得(RPC exhibition_breakdown)。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ExhibitionRow } from "@/lib/exhibition-analysis";

export async function getExhibitionBreakdown(start: string, end: string): Promise<ExhibitionRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("exhibition_breakdown", { p_start: start, p_end: end });
  return (data ?? []) as ExhibitionRow[];
}

export interface DealRoiRow {
  detail: string;
  deals: number;
  revenue: number;
  open_deals: number;
  open_amount: number;
  cost: number;
}
/** 展示会/施策(案件の詳細)別の受注/売上/原価/ROI。 */
export async function getExhibitionDealRoi(start: string, end: string): Promise<DealRoiRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("exhibition_deal_roi", { p_start: start, p_end: end });
  return (data ?? []) as DealRoiRow[];
}
