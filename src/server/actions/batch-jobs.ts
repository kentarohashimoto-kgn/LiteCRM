"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

const ADMIN_ROLES = ["owner", "admin"];

/**
 * AIバッチジョブのスタート/停止(batch_job_settings.enabled)を切り替える。
 * 停止中はF1 ingest APIが対象0件/409を返し、夜間セッションも何もしない。
 */
export async function toggleBatchJobAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/exec/batch?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  const to = String(formData.get("to") ?? "") === "start";
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id) back("error=invalid");

  const sb = getSupabaseServer();
  const up = await sb
    .from("batch_job_settings")
    .update({ enabled: to, note, updated_by: ctx.userId })
    .eq("id", id)
    .select("job_kind");
  if (up.error || !up.data?.length) back("error=save_failed");

  revalidatePath("/app/exec/batch");
  back(to ? "saved=started" : "saved=stopped");
}
