/** 施策ROIのデータ取得(RPC channel_roi + マスタ/コスト)。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { deriveRoi, type ChannelRoiRaw, type ChannelRoiRow } from "@/lib/roi";

export interface MarketingChannel {
  id: string;
  name: string;
  category: string | null;
  lead_source_id: string | null;
  kind: string | null;
  cost_model: string | null;
  default_monthly_cost: number | null;
  per_result_cost: number | null;
  committed_metric: string | null;
  committed_qty: number | null;
  target_level: string | null;
  priority_flag: boolean;
  status: string;
  sort_order: number | null;
  notes: string | null;
}

export interface ChannelCost {
  id: string;
  channel_id: string;
  month: string;
  fixed_cost: number;
  variable_cost: number;
  result_qty: number | null;
  memo: string | null;
}

export async function getChannelRoi(start: string, end: string): Promise<ChannelRoiRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("channel_roi", { p_start: start, p_end: end });
  const rows = (data ?? []) as ChannelRoiRaw[];
  return rows.map(deriveRoi);
}

export async function listMarketingChannels(): Promise<MarketingChannel[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("marketing_channels")
    .select("id,name,category,lead_source_id,kind,cost_model,default_monthly_cost,per_result_cost,committed_metric,committed_qty,target_level,priority_flag,status,sort_order,notes")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data ?? []) as MarketingChannel[];
}

/** データの存在する会計年度(開始年)の一覧。最古リード〜当年度。 */
export async function getRoiFiscalYears(currentFy: number): Promise<number[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("leads").select("acquired_at").order("acquired_at", { ascending: true }).limit(1);
  const first = (data?.[0]?.acquired_at as string | undefined) ?? null;
  let from = currentFy;
  if (first) {
    const d = new Date(first);
    from = d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  }
  const years: number[] = [];
  for (let y = currentFy; y >= Math.min(from, currentFy); y--) years.push(y);
  return years.length ? years : [currentFy];
}

/** 期間内の施策コスト(画面の月次入力の既存値表示用)。 */
export async function listChannelCosts(start: string, end: string): Promise<ChannelCost[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("channel_costs")
    .select("id,channel_id,month,fixed_cost,variable_cost,result_qty,memo")
    .gte("month", start)
    .lt("month", end)
    .order("month", { ascending: false });
  return (data ?? []) as ChannelCost[];
}
