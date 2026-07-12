"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { buildWeeklyPayload } from "@/lib/data/weekly-snapshot";

/**
 * いまの週次サマリをスナップショットとして保存する(form action)。
 * 主要数値を payload に丸ごと固定するので、後からその週の状態を同じ見た目で振り返れる。
 * 保存には編集権限(can_edit_role)が必要(RLS)。
 */
export async function saveWeeklySnapshotAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const note = String(formData.get("note") ?? "").trim();
  const payload = await buildWeeklyPayload(new Date());

  const sb = getSupabaseServer();
  await sb.from("weekly_report_snapshots").insert({
    tenant_id: ctx.tenantId,
    week_start: payload.weekStart,
    note: note || null,
    payload,
    created_by: ctx.userId,
  });

  revalidatePath("/app/reviews/snapshots");
}

/** スナップショットを削除(誤保存の取り消し)。 */
export async function deleteWeeklySnapshotAction(formData: FormData): Promise<void> {
  await requireCtx();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = getSupabaseServer();
  await sb.from("weekly_report_snapshots").delete().eq("id", id);
  revalidatePath("/app/reviews/snapshots");
}
