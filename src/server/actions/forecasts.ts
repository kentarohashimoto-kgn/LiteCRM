"use server";

import { revalidatePath } from "next/cache";
import { requireProjectCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null): number | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** month入力(YYYY-MM)を date(YYYY-MM-01)へ。 */
function monthDate(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s ? `${s.slice(0, 7)}-01` : null;
}

/** デリバリー見込みを作成/更新する。 */
export async function saveDeliveryForecastAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const id = str(formData.get("id"));

  const prob = num(formData.get("probability"));
  const patch = {
    kind: str(formData.get("kind")) === "new" ? "new" : "continuation",
    title: str(formData.get("title")) ?? "見込み",
    start_month: monthDate(formData.get("start_month")),
    end_month: monthDate(formData.get("end_month")),
    amount: num(formData.get("amount")),
    amount_basis: str(formData.get("amount_basis")) === "total" ? "total" : "monthly",
    probability: prob == null ? 50 : Math.max(0, Math.min(100, Math.round(prob))),
    required_headcount: num(formData.get("required_headcount")),
    staffing_status: (["ready", "shortage", "unknown"].includes(String(formData.get("staffing_status"))) ? String(formData.get("staffing_status")) : "unknown"),
    arrange_deadline: str(formData.get("arrange_deadline")),
    notes: str(formData.get("notes")),
  };

  if (id) {
    await sb.from("delivery_forecasts").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  } else {
    await sb.from("delivery_forecasts").insert({ tenant_id: ctx.tenantId, owner_user_id: ctx.userId, created_by: ctx.userId, ...patch });
  }
  revalidatePath("/app/projects");
}

/** デリバリー見込みを削除する。 */
export async function deleteDeliveryForecastAction(formData: FormData) {
  const ctx = await requireProjectCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  await sb.from("delivery_forecasts").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/projects");
}
