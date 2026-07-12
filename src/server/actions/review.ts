"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * 確認キュー: AI要約を「確認済み」にする(form action)。
 * これでキューから外れる。要約本文はそのまま活用され、破壊はしない。
 * 修正が必要なら商談詳細で編集してから、あるいは編集後にここで確認する。
 */
export async function markSummaryReviewedAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const meetingId = String(formData.get("meeting_id") ?? "");
  if (!meetingId) return;

  const sb = getSupabaseServer();
  await sb
    .from("meetings")
    .update({
      ai_summary_reviewed_at: new Date().toISOString(),
      ai_summary_reviewed_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", meetingId);

  revalidatePath("/app/review");
}
