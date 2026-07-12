"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/** 営業マン別週報のナラティブを保存(upsert: 1営業マン×1週で1行)。 */
export async function saveRepReportAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const ownerUserId = String(formData.get("owner_user_id") ?? "").trim() || ctx.userId;
  const weekStart = String(formData.get("week_start") ?? "").trim();
  if (!weekStart) return;
  const s = (k: string) => String(formData.get(k) ?? "").trim() || null;

  const sb = getSupabaseServer();
  await sb.from("weekly_rep_reports").upsert(
    {
      tenant_id: ctx.tenantId,
      owner_user_id: ownerUserId,
      week_start: weekStart,
      last_week_comment: s("last_week_comment"),
      next_week_plan: s("next_week_plan"),
      month_ahead_plan: s("month_ahead_plan"),
      note: s("note"),
      created_by: ctx.userId,
    },
    { onConflict: "tenant_id,owner_user_id,week_start" },
  );

  revalidatePath("/app/reviews/rep");
}
