"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/* ============================================================
 * 所属会社(請求元)マスタ — 人事のみ
 * 担当者の所属先。ここに登録した会社が月次請求サマリーの請求元になる。
 * ============================================================ */

const str = (fd: FormData, k: string): string | null => String(fd.get(k) || "").trim() || null;

/** 消費税率(%)。空欄・不正は既定10%。0(免税事業者)は有効値。 */
function taxRate(fd: FormData, k: string): number {
  const raw = String(fd.get(k) || "").replace(/[^\d.]/g, "");
  if (!raw) return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 10;
}

const back = (q: string): never => redirect(`/app/hr/companies?${q}`);

/** 所属会社を登録。 */
export async function createTalentCompanyAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const name = String(formData.get("name") || "").trim();
  if (!name) back("error=invalid");

  const ins = await sb.from("talent_companies").insert({
    tenant_id: ctx.tenantId,
    name,
    billing_name: str(formData, "billing_name"),
    invoice_no: str(formData, "invoice_no"),
    tax_rate: taxRate(formData, "tax_rate"),
    payment_terms: str(formData, "payment_terms"),
    contact_email: str(formData, "contact_email"),
    notes: str(formData, "notes"),
  });
  if (ins.error) back(ins.error.code === "23505" ? "error=duplicate" : "error=save_failed");

  revalidatePath("/app/hr/companies");
  revalidatePath("/app/hr/talents");
  back("saved=create");
}

/** 所属会社を更新 / 休止・再開 / 削除。 */
export async function updateTalentCompanyAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id") || "").trim();
  const op = String(formData.get("op") || "save");
  if (!id) back("error=invalid");

  if (op === "delete") {
    // 所属者が残っている会社を消すと請求集計から抜け落ちるため、先に付け替えてもらう
    const used = await sb.from("talents").select("id").eq("company_id", id).limit(1);
    if (used.error) back("error=load_failed");
    if (used.data?.length) back("error=in_use");
    const del = await sb.from("talent_companies").delete().eq("id", id);
    if (del.error) back("error=in_use");
  } else if (op === "toggle_active") {
    const cur = await sb.from("talent_companies").select("is_active").eq("id", id).maybeSingle();
    if (cur.error || !cur.data) back("error=load_failed");
    const upd = await sb.from("talent_companies").update({ is_active: !cur.data!.is_active }).eq("id", id);
    if (upd.error) back("error=save_failed");
  } else {
    const name = String(formData.get("name") || "").trim();
    if (!name) back("error=invalid");
    const upd = await sb
      .from("talent_companies")
      .update({
        name,
        billing_name: str(formData, "billing_name"),
        invoice_no: str(formData, "invoice_no"),
        tax_rate: taxRate(formData, "tax_rate"),
        payment_terms: str(formData, "payment_terms"),
        contact_email: str(formData, "contact_email"),
        notes: str(formData, "notes"),
      })
      .eq("id", id);
    if (upd.error) back(upd.error.code === "23505" ? "error=duplicate" : "error=save_failed");
  }

  revalidatePath("/app/hr/companies");
  revalidatePath("/app/hr/talents");
  back(op === "delete" ? "saved=delete" : "saved=save");
}
