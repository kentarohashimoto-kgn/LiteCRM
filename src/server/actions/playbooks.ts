"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/** B1 カトルセの型を登録(form action)。 */
export async function createPlaybookAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const s = (k: string) => String(formData.get(k) ?? "").trim() || null;

  const sb = getSupabaseServer();
  await sb.from("sales_playbooks").insert({
    tenant_id: ctx.tenantId,
    title,
    industry: s("industry"),
    employee_size_band: s("employee_size_band"),
    target_role: s("target_role"),
    hypothesis_issues: s("hypothesis_issues"),
    value_props: s("value_props"),
    key_questions: s("key_questions"),
    proposal_flow: s("proposal_flow"),
    objections: s("objections"),
    decision_tips: s("decision_tips"),
    source: "manual",
    status: "active",
    created_by: ctx.userId,
  });

  revalidatePath("/app/playbooks");
}

/** 型を削除。 */
export async function deletePlaybookAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = getSupabaseServer();
  await sb.from("sales_playbooks").delete().eq("id", id);
  revalidatePath("/app/playbooks");
}
