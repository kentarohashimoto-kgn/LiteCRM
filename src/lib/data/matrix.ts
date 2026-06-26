/** 施策×顧客レベル クロス集計のデータ取得(RPC channel_level_matrix)。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";

export interface MatrixCell { leads: number; deals: number; revenue: number }
export interface MatrixRow {
  id: string;
  name: string;
  category: string | null;
  cells: Record<string, MatrixCell>;
}

export async function getChannelLevelMatrix(start: string, end: string): Promise<MatrixRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("channel_level_matrix", { p_start: start, p_end: end });
  return (data ?? []) as MatrixRow[];
}
