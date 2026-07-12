"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

const KINDS = ["knowhow", "win_reason", "loss_reason", "case_study"] as const;

/** B7 ノウハウ・事例を登録(form action)。 */
export async function createKnowledgeAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const kindRaw = String(formData.get("kind") ?? "knowhow");
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "knowhow";
  const tags = String(formData.get("tags") ?? "")
    .split(/[,、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const sb = getSupabaseServer();
  await sb.from("knowledge_entries").insert({
    tenant_id: ctx.tenantId,
    kind,
    title,
    body: String(formData.get("body") ?? "").trim(),
    is_own_company: formData.get("is_own_company") != null,
    industry: String(formData.get("industry") ?? "").trim() || null,
    competitor: String(formData.get("competitor") ?? "").trim() || null,
    tags,
    source: "manual",
    status: "approved",
    created_by: ctx.userId,
  });

  revalidatePath("/app/knowledge");
}

/** ノウハウ・事例を削除。 */
export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = getSupabaseServer();
  await sb.from("knowledge_entries").delete().eq("id", id);
  revalidatePath("/app/knowledge");
}
