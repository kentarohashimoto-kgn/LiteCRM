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

/** 案件ごとの「担当の読み」(成約月/売上額/残商談回数)を保存。週報の担当案件リストから行単位で更新。 */
export async function saveRepForecastAction(formData: FormData): Promise<void> {
  await requireCtx();
  const oppId = String(formData.get("opp_id") ?? "");
  if (!oppId) return;

  const month = String(formData.get("rep_close_month") ?? "").trim(); // <input type="month"> は YYYY-MM
  const amountRaw = String(formData.get("rep_amount_forecast") ?? "").replace(/[,、]/g, "").trim();
  const leftRaw = String(formData.get("rep_meetings_left") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  const left = leftRaw ? Number(leftRaw) : null;

  const sb = getSupabaseServer();
  await sb
    .from("opportunities")
    .update({
      rep_close_month: /^\d{4}-\d{2}$/.test(month) ? month : null,
      rep_amount_forecast: amount != null && Number.isFinite(amount) ? amount : null,
      rep_meetings_left: left != null && Number.isInteger(left) && left >= 0 ? left : null,
    })
    .eq("id", oppId);

  revalidatePath("/app/reviews/rep");
}
