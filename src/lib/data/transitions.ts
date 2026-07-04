/** 研修後トランジションのデータ取得。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";

export interface Transition {
  id: string;
  original_opportunity_id: string;
  initial_product: string | null;
  delivery_date: string | null;
  status: string;
  followup_3days_status: string;
  followup_2weeks_status: string;
  proposal_30days_status: string;
  created_at: string;
}

export const TRANSITION_STATUS_LABEL: Record<string, string> = {
  active: "進行中", converted: "アップセル成立", closed: "終了", on_hold: "保留",
};
export const FOLLOWUP_STATUS_LABEL: Record<string, string> = {
  not_started: "未着手", done: "完了", overdue: "期限超過",
};

export async function getTransitionsByAccount(accountId: string): Promise<Transition[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("transitions")
    .select("id,original_opportunity_id,initial_product,delivery_date,status,followup_3days_status,followup_2weeks_status,proposal_30days_status,created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Transition[];
}
