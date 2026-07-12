"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getRepReport } from "@/lib/data/rep-report";
import { mondayJst } from "@/lib/data/weekly-snapshot";

/**
 * 営業マン別週報のナラティブ＋自動集計サマリーをスナップショット保存(upsert: 1営業マン×1週で1行)。
 * 保存時点の目標/実績/見込み/パイプライン/ファネル/推移/担当案件を payload に固定する。
 */
export async function saveRepReportAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const ownerUserId = String(formData.get("owner_user_id") ?? "").trim() || ctx.userId;
  const weekStart = String(formData.get("week_start") ?? "").trim() || mondayJst(new Date());
  const s = (k: string) => String(formData.get(k) ?? "").trim() || null;

  // 保存時点の自動集計をスナップショット
  const rep = await getRepReport(ownerUserId, weekStart);
  const payload = {
    takenAt: new Date().toISOString(),
    ownerName: rep.ownerName,
    month: rep.month,
    pipeline: rep.pipeline,
    funnel: rep.funnel,
    trendMonthly: rep.trendMonthly,
    trendWeekly: rep.trendWeekly,
    opps: rep.opps.map((o) => ({
      name: o.name, account: o.account, yomi: o.yomi, amount: o.amount, weighted: o.weighted,
      repCloseMonth: o.repCloseMonth, repAmountForecast: o.repAmountForecast, repMeetingsLeft: o.repMeetingsLeft,
      statusNote: o.statusNote,
    })),
  };

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
      payload,
      created_by: ctx.userId,
    },
    { onConflict: "tenant_id,owner_user_id,week_start" },
  );

  revalidatePath("/app/reviews/rep");
}

/** 案件ごとの「担当の読み」(成約月/売上額/残商談回数)＋1行メモを保存。担当案件リストから行単位で更新。 */
export async function saveRepForecastAction(formData: FormData): Promise<void> {
  await requireCtx();
  const oppId = String(formData.get("opp_id") ?? "");
  if (!oppId) return;

  const month = String(formData.get("rep_close_month") ?? "").trim(); // <input type="month"> は YYYY-MM
  const amountRaw = String(formData.get("rep_amount_forecast") ?? "").replace(/[,、]/g, "").trim();
  const leftRaw = String(formData.get("rep_meetings_left") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  const left = leftRaw ? Number(leftRaw) : null;
  const note = String(formData.get("rep_status_note") ?? "").trim();

  const sb = getSupabaseServer();
  await sb
    .from("opportunities")
    .update({
      rep_close_month: /^\d{4}-\d{2}$/.test(month) ? month : null,
      rep_amount_forecast: amount != null && Number.isFinite(amount) ? amount : null,
      rep_meetings_left: left != null && Number.isInteger(left) && left >= 0 ? left : null,
      rep_status_note: note || null,
    })
    .eq("id", oppId);

  revalidatePath("/app/reviews/rep");
}

/**
 * 今月目標の個人ブレークダウン: rep_targets を upsert(1営業マン×1月)。
 * 管理職は誰の分でも、本人は自分の分を設定可(週報の閲覧権限に準ずる)。
 */
export async function saveRepMonthlyTargetAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const userId = String(formData.get("owner_user_id") ?? "").trim() || ctx.userId;
  const month = String(formData.get("target_month") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const amountRaw = String(formData.get("target_amount") ?? "").replace(/[,、]/g, "").trim();
  const amount = amountRaw ? Number(amountRaw) : 0;
  if (!Number.isFinite(amount) || amount < 0) return;

  const sb = getSupabaseServer();
  await sb.from("rep_targets").upsert(
    { tenant_id: ctx.tenantId, user_id: userId, target_month: month, target_amount: amount },
    { onConflict: "tenant_id,user_id,target_month" },
  );
  revalidatePath("/app/reviews/rep");
}
