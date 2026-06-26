/** 受注見込み(来期計画)のデータ取得。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { RevForecast } from "@/lib/revenue-forecast";

export async function listRevenueForecasts(fyStart: number): Promise<RevForecast[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("revenue_forecasts")
    .select("id,seq,account_name,product,deal_name,note,period_label,period_start,period_end,amount,cost,probability,expected_order_date,owner,memo,entered_on,source_updated_on,fy_start,status")
    .eq("fy_start", fyStart)
    .order("seq", { ascending: true });
  return (data ?? []) as RevForecast[];
}

/** データの存在する年度(fy_start)一覧。 */
export async function getForecastYears(): Promise<number[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("revenue_forecasts").select("fy_start");
  const set = new Set<number>();
  for (const r of data ?? []) if (r.fy_start != null) set.add(r.fy_start as number);
  return Array.from(set).sort((a, b) => b - a);
}
