import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * 全社月間目標の「担当×流入元」配分。担当分は rep_targets(→営業マン別週報の目標)へ反映される。
 */

export type Allocation = {
  id: string;
  owner_user_id: string | null;
  lead_source_id: string | null;
  label: string | null;
  amount: number;
  sort_order: number;
};

export async function getAllocations(month: string): Promise<Allocation[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("target_allocations")
    .select("id,owner_user_id,lead_source_id,label,amount,sort_order")
    .eq("target_month", month)
    .order("sort_order", { ascending: true });
  return (data ?? []) as Allocation[];
}
