"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

const MGMT = ["owner", "admin", "sales_manager"];

/** 月キーを YYYY-MM-01 に正規化(monthKey互換)。不正なら null。 */
function normMonth(v: string): string | null {
  const m = v.trim().match(/^(\d{4})-(\d{2})(-\d{2})?$/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/**
 * 月間目標の配分を保存。担当×流入元の配分行を洗い替えし、担当分の合計を rep_targets(→週報目標)へ反映。
 * 結果は ?saved= / ?error= でリダイレクト通知(無言の失敗をなくす)。配分の設定は管理ロールのみ(RLSでも担保)。
 */
export async function saveAllocationsAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const fy = String(formData.get("fy") ?? "").trim();
  const back = (q: string) => redirect(`/app/targets?scope=alloc${fy ? `&fy=${fy}` : ""}&${q}`);

  if (!MGMT.includes(ctx.role)) back("error=forbidden");
  const month = normMonth(String(formData.get("target_month") ?? ""));
  if (!month) back("error=invalid_month");

  const owners = formData.getAll("alloc_owner").map((v) => String(v));
  const sources = formData.getAll("alloc_source").map((v) => String(v));
  const labels = formData.getAll("alloc_label").map((v) => String(v));
  const amounts = formData.getAll("alloc_amount").map((v) => Number(String(v).replace(/[^\d]/g, "")) || 0);
  const n = Math.max(owners.length, sources.length, labels.length, amounts.length);

  const rows: {
    tenant_id: string;
    target_month: string;
    owner_user_id: string | null;
    lead_source_id: string | null;
    label: string | null;
    amount: number;
    sort_order: number;
    created_by: string;
  }[] = [];
  const repSum = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const owner = (owners[i] ?? "").trim() || null;
    const source = (sources[i] ?? "").trim() || null;
    const label = (labels[i] ?? "").trim() || null;
    const amount = amounts[i] ?? 0;
    // 空行(配分先も金額も無い)はスキップ
    if (!owner && !source && !label && amount === 0) continue;
    rows.push({
      tenant_id: ctx.tenantId,
      target_month: month!,
      owner_user_id: owner,
      lead_source_id: source,
      label,
      amount,
      sort_order: i,
      created_by: ctx.userId,
    });
    if (owner) repSum.set(owner, (repSum.get(owner) ?? 0) + amount);
  }

  const sb = getSupabaseServer();
  // 当月の配分を洗い替え
  const del = await sb.from("target_allocations").delete().eq("target_month", month!);
  if (del.error) back("error=save_failed");
  if (rows.length) {
    const ins = await sb.from("target_allocations").insert(rows);
    if (ins.error) back("error=save_failed");
  }

  // 担当分の合計を rep_targets へ反映(→ 営業マン別週報の目標)
  if (repSum.size) {
    const repRows = Array.from(repSum.entries()).map(([user_id, target_amount]) => ({
      tenant_id: ctx.tenantId,
      user_id,
      target_month: month!,
      target_amount,
    }));
    const up = await sb.from("rep_targets").upsert(repRows, { onConflict: "tenant_id,user_id,target_month" });
    if (up.error) back("error=rep_reflect_failed");
  }

  revalidatePath("/app/targets");
  revalidatePath("/app/reviews/rep");
  back(`month=${month}&saved=alloc`);
}
