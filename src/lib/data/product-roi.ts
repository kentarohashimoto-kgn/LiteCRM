/** プロダクト収益・サブスク指標のデータ取得(RPC + billing一覧)。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { deriveProduct, type ProductRoiRaw, type ProductRoiRow } from "@/lib/product-roi";

export interface SubMonth {
  month: string;
  mrr: number;
  new_mrr: number;
  churn_mrr: number;
  active: number;
}

export interface SubscriptionRow {
  id: string;
  amount: number;
  recurring_start_month: string | null;
  recurring_end_month: string | null;
  sub_status: string | null;
  canceled_month: string | null;
  cancel_reason: string | null;
  account_name: string | null;
}

export async function getProductProfitability(start: string, end: string): Promise<ProductRoiRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("product_profitability", { p_start: start, p_end: end });
  return ((data ?? []) as ProductRoiRaw[]).map(deriveProduct);
}

export async function getSubscriptionMetrics(start: string, end: string): Promise<SubMonth[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("subscription_metrics", { p_start: start, p_end: end });
  return (data ?? []) as SubMonth[];
}

/** 継続課金(サブスク)契約の一覧。手動の解約入力UI用。 */
export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("billing_schedules")
    .select("id,amount,recurring_start_month,recurring_end_month,sub_status,canceled_month,cancel_reason,accounts(name)")
    .eq("kind", "recurring")
    .order("recurring_start_month", { ascending: false });
  return ((data ?? []) as unknown[]).map((r) => {
    const x = r as Record<string, unknown> & { accounts?: { name?: string } | { name?: string }[] };
    const acc = Array.isArray(x.accounts) ? x.accounts[0] : x.accounts;
    return {
      id: x.id as string,
      amount: (x.amount as number) ?? 0,
      recurring_start_month: (x.recurring_start_month as string) ?? null,
      recurring_end_month: (x.recurring_end_month as string) ?? null,
      sub_status: (x.sub_status as string) ?? "active",
      canceled_month: (x.canceled_month as string) ?? null,
      cancel_reason: (x.cancel_reason as string) ?? null,
      account_name: acc?.name ?? null,
    };
  });
}
