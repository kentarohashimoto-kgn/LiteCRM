"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { CONTENT_STATUS_ORDER, type ContentStatus } from "@/lib/data/content-ideas";

/** B8 記事ネタを登録(form action)。 */
export async function createContentIdeaAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const s = (k: string) => String(formData.get(k) ?? "").trim() || null;

  const sb = getSupabaseServer();
  await sb.from("content_ideas").insert({
    tenant_id: ctx.tenantId,
    title,
    theme: s("theme"),
    angle: s("angle"),
    target_keyword: s("target_keyword"),
    note: s("note"),
    source: "manual",
    status: "idea",
    created_by: ctx.userId,
  });
  revalidatePath("/app/content");
}

/** ステータスを次段階へ進める(idea→selected→drafting→published)。 */
export async function advanceContentStatusAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id") ?? "");
  const current = String(formData.get("current") ?? "") as ContentStatus;
  if (!id) return;
  const idx = CONTENT_STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= CONTENT_STATUS_ORDER.length - 1) return;
  const next = CONTENT_STATUS_ORDER[idx + 1];

  const sb = getSupabaseServer();
  await sb.from("content_ideas").update({ status: next }).eq("id", id);
  revalidatePath("/app/content");
}

/** 記事ネタを削除。 */
export async function deleteContentIdeaAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = getSupabaseServer();
  await sb.from("content_ideas").delete().eq("id", id);
  revalidatePath("/app/content");
}
