"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getRepReport, getRepOppDetail, type RepOppDetail } from "@/lib/data/rep-report";
import { mondayJst } from "@/lib/data/weekly-snapshot";
import { YOMI_OPTIONS } from "@/lib/constants";
import { attachReasonToLatestYomiLog } from "@/server/actions/yomi";

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
  redirect(`/app/reviews/rep?owner=${encodeURIComponent(ownerUserId)}&week=${encodeURIComponent(weekStart)}&saved=report`);
}

/** 月キーを YYYY-MM-01 に正規化(monthKey互換)。 */
function normMonth(v: string): string | null {
  const m = v.trim().match(/^(\d{4})-(\d{2})(-\d{2})?$/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** 案件ごとの「担当の読み」(成約月/売上額/残商談回数)＋1行メモを保存。担当案件リストから行単位で更新。 */
export async function saveRepForecastAction(formData: FormData): Promise<void> {
  await requireCtx();
  const oppId = String(formData.get("opp_id") ?? "");
  const backOwner = String(formData.get("back_owner") ?? "");
  const backWeek = String(formData.get("back_week") ?? "");
  const back = (q: string) =>
    redirect(`/app/reviews/rep?owner=${encodeURIComponent(backOwner)}&week=${encodeURIComponent(backWeek)}&${q}`);
  if (!oppId) back("error=save_failed");

  // 金額・成約予定は公式の案件情報へ集約(読みとして分離しない)
  const month = String(formData.get("expected_close_month") ?? "").trim(); // <input type="month"> は YYYY-MM
  const amountRaw = String(formData.get("amount") ?? "").replace(/[,、]/g, "").trim();
  const leftRaw = String(formData.get("rep_meetings_left") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw.replace(/[^\d.]/g, "")) : null;
  const left = leftRaw ? Number(leftRaw) : null;
  const note = String(formData.get("rep_status_note") ?? "").trim();

  // ヨミの変更(一覧から直接)。変更はDBトリガーが履歴(yomi_change_logs)に自動記録する
  const yomiProvided = formData.has("yomi");
  const yomiRaw = String(formData.get("yomi") ?? "").trim();
  const yomi = YOMI_OPTIONS.some((o) => o.key === yomiRaw) ? yomiRaw : null;

  const patch: Record<string, unknown> = {
    rep_meetings_left: left != null && Number.isInteger(left) && left >= 0 ? left : null,
    rep_status_note: note || null,
  };
  if (formData.has("amount")) patch.amount = amount != null && Number.isFinite(amount) && amount >= 0 ? amount : 0;
  if (formData.has("expected_close_month")) patch.expected_close_date = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;
  if (yomiProvided) patch.yomi = yomi;

  const sb = getSupabaseServer();
  const up = await sb.from("opportunities").update(patch).eq("id", oppId);
  if (up.error) back("error=save_failed");

  // 同時に入力された要因を、いま記録された履歴行と受注/失注分析(win_reason/lost_reason)へ反映
  const reason = String(formData.get("yomi_reason") ?? "").trim();
  if (yomiProvided && reason) {
    await attachReasonToLatestYomiLog(oppId, yomi, reason);
  }

  revalidatePath("/app/reviews/rep");
  revalidatePath("/app/reviews/yomi-history");
  back("saved=opp");
}

/**
 * 今月目標の個人ブレークダウン: rep_targets を upsert(1営業マン×1月)。
 * 管理職は誰の分でも、本人は自分の分を設定可(週報の閲覧権限に準ずる)。
 */
export async function saveRepMonthlyTargetAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const userId = String(formData.get("owner_user_id") ?? "").trim() || ctx.userId;
  const backWeek = String(formData.get("back_week") ?? "");
  const back = (q: string) =>
    redirect(`/app/reviews/rep?owner=${encodeURIComponent(userId)}&week=${encodeURIComponent(backWeek)}&${q}`);

  // 月キーは YYYY-MM-01(monthKey互換)。旧実装は YYYY-MM 前提の検証で黙って失敗していた(バグ修正)
  const month = normMonth(String(formData.get("target_month") ?? ""));
  if (!month) back("error=invalid_month");
  const amountRaw = String(formData.get("target_amount") ?? "").replace(/[^\d]/g, "").trim();
  const amount = amountRaw ? Number(amountRaw) : 0;
  if (!Number.isFinite(amount) || amount < 0) back("error=invalid_amount");

  const sb = getSupabaseServer();
  const up = await sb.from("rep_targets").upsert(
    { tenant_id: ctx.tenantId, user_id: userId, target_month: month!, target_amount: amount },
    { onConflict: "tenant_id,user_id,target_month" },
  );
  if (up.error) back("error=save_failed");
  revalidatePath("/app/reviews/rep");
  back("saved=target");
}

// ===================== 週報サイドパネル(クライアントから関数呼び出し) =====================

/** サイドパネル用: 案件レビュー情報を取得(クライアントコンポーネントから呼ぶ)。 */
export async function getRepOppDetailAction(oppId: string): Promise<RepOppDetail | null> {
  await requireCtx();
  if (!oppId) return null;
  return getRepOppDetail(oppId);
}

export type SaveRepOppResult = { ok: true } | { ok: false; error: string };

/**
 * サイドパネル用: 案件のヨミ＋担当の読み(成約月/売上/残商談)＋メモを保存。
 * リダイレクトせず結果を返す(パネルを閉じずに連続更新するため)。
 * ヨミ変更はDBトリガーが履歴記録し、要因(reason)は履歴＋受注/失注分析へ反映。
 */
export async function saveRepOppFieldsAction(input: {
  oppId: string;
  // 案件情報(公式フィールドに集約)
  yomi?: string | null;
  amount?: number | null;
  expectedCloseMonth?: string | null; // YYYY-MM → expected_close_date=月初
  probability?: number | null; // 0-100
  // 週報用
  repMeetingsLeft?: number | null;
  statusNote?: string | null;
  yomiReason?: string | null;
}): Promise<SaveRepOppResult> {
  await requireCtx();
  if (!input.oppId) return { ok: false, error: "案件が指定されていません" };

  const yomiProvided = input.yomi !== undefined;
  const yomi = yomiProvided ? (YOMI_OPTIONS.some((o) => o.key === input.yomi) ? input.yomi! : null) : undefined;
  const left = input.repMeetingsLeft;

  const patch: Record<string, unknown> = {
    rep_meetings_left: left != null && Number.isInteger(left) && left >= 0 ? left : null,
    rep_status_note: (input.statusNote ?? "").trim() || null,
  };
  if (yomiProvided) patch.yomi = yomi;
  // 金額・成約予定・確率は公式の案件情報へ直接反映(読みとして分離しない)
  if (input.amount !== undefined) patch.amount = input.amount != null && Number.isFinite(input.amount) && input.amount >= 0 ? input.amount : 0;
  if (input.expectedCloseMonth !== undefined) {
    const m = (input.expectedCloseMonth ?? "").trim();
    patch.expected_close_date = /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : null;
  }
  if (input.probability !== undefined) {
    const p = input.probability;
    patch.probability = p != null && Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : null;
  }

  const sb = getSupabaseServer();
  const up = await sb.from("opportunities").update(patch).eq("id", input.oppId);
  if (up.error) return { ok: false, error: up.error.message };

  const reason = (input.yomiReason ?? "").trim();
  if (yomiProvided && reason) {
    await attachReasonToLatestYomiLog(input.oppId, yomi ?? null, reason);
  }

  revalidatePath("/app/reviews/rep");
  revalidatePath("/app/reviews/yomi-history");
  return { ok: true };
}
