/** Sランク顧客攻略のデータアクセス(既存opportunitiesで受注/見込みを補強)。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import type { SrankAccount, SrankDepartment, SrankKeyperson } from "@/lib/types";

export interface SrankRow extends SrankAccount {
  deptCount: number;
  keypersonCount: number;
  deptAmount: number;     // 部署別見込み合計
  wonAmount: number;      // 既存受注額(accountに紐づくwon)
  openAmount: number;     // 進行中見込み
  alerts: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function listSrankAccounts(): Promise<SrankRow[]> {
  const sb = getSupabaseServer();
  const [{ data: accs }, { data: depts }, { data: kps }, { data: opps }] = await Promise.all([
    sb.from("srank_accounts").select("*").order("target_sales", { ascending: false, nullsFirst: false }),
    sb.from("srank_departments").select("srank_account_id,amount,proposal_status,next_action_date"),
    sb.from("srank_keypersons").select("srank_account_id"),
    sb.from("opportunities").select("account_id,status,amount"),
  ]);
  const deptByAcc = new Map<string, any[]>();
  for (const d of depts ?? []) { const a = deptByAcc.get(d.srank_account_id) ?? []; a.push(d); deptByAcc.set(d.srank_account_id, a); }
  const kpByAcc = new Map<string, number>();
  for (const k of kps ?? []) kpByAcc.set(k.srank_account_id, (kpByAcc.get(k.srank_account_id) ?? 0) + 1);
  const wonByAcc = new Map<string, number>(); const openByAcc = new Map<string, number>();
  for (const o of opps ?? []) {
    if (!o.account_id) continue;
    if (o.status === "won") wonByAcc.set(o.account_id, (wonByAcc.get(o.account_id) ?? 0) + (o.amount ?? 0));
    else if (o.status === "open") openByAcc.set(o.account_id, (openByAcc.get(o.account_id) ?? 0) + (o.amount ?? 0));
  }
  const td = today();
  return (accs ?? []).map((a: SrankAccount) => {
    const ds = deptByAcc.get(a.id) ?? [];
    const deptAmount = ds.reduce((s, d) => s + (d.amount ?? 0), 0);
    const wonAmount = a.account_id ? wonByAcc.get(a.account_id) ?? 0 : 0;
    const openAmount = a.account_id ? openByAcc.get(a.account_id) ?? 0 : 0;
    const alerts: string[] = [];
    if (ds.length <= 1) alerts.push("単一部署");
    if (!a.exec_contact) alerts.push("経営層接点なし");
    if (a.target_sales && a.target_sales > 0 && (wonAmount + openAmount) / a.target_sales < 0.3) alerts.push("目標進捗30%未満");
    if (ds.some((d) => !d.next_action_date)) alerts.push("次アクション未設定の部署");
    return {
      ...a, deptCount: ds.length, keypersonCount: kpByAcc.get(a.id) ?? 0, deptAmount, wonAmount, openAmount, alerts,
    };
  });
}

export async function getSrankDetail(id: string): Promise<{ account: SrankAccount | null; departments: SrankDepartment[]; keypersons: SrankKeyperson[] }> {
  const sb = getSupabaseServer();
  const [{ data: account }, { data: departments }, { data: keypersons }] = await Promise.all([
    sb.from("srank_accounts").select("*").eq("id", id).maybeSingle(),
    sb.from("srank_departments").select("*").eq("srank_account_id", id).order("created_at"),
    sb.from("srank_keypersons").select("*").eq("srank_account_id", id).order("created_at"),
  ]);
  return { account: (account as SrankAccount) ?? null, departments: (departments ?? []) as SrankDepartment[], keypersons: (keypersons ?? []) as SrankKeyperson[] };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
