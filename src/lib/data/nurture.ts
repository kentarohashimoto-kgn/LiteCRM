/** 既存顧客深耕のデータ(深耕拡張＋接点履歴)。受注/売上は既存opportunitiesから集計。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { AccountNurture, NurtureTouch } from "@/lib/types";

export async function getNurtureExtras(): Promise<{
  nurtureByAccount: Map<string, AccountNurture>;
  touchesByAccount: Map<string, NurtureTouch[]>;
}> {
  const sb = getSupabaseServer();
  const [{ data: nurture }, { data: touches }] = await Promise.all([
    sb.from("account_nurture").select("*"),
    sb.from("nurture_touches").select("*").order("touched_at", { ascending: false, nullsFirst: false }),
  ]);
  const nurtureByAccount = new Map<string, AccountNurture>();
  for (const n of (nurture ?? []) as AccountNurture[]) nurtureByAccount.set(n.account_id, n);
  const touchesByAccount = new Map<string, NurtureTouch[]>();
  for (const t of (touches ?? []) as NurtureTouch[]) {
    const a = touchesByAccount.get(t.account_id) ?? [];
    a.push(t);
    touchesByAccount.set(t.account_id, a);
  }
  return { nurtureByAccount, touchesByAccount };
}
