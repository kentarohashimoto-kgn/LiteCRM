"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * 記入された要因を opportunities にも反映する(既存の成約/失注分析に流す)。
 * 受注→win_reason / オチ→lost_reason。手入力済みの値は上書きしない(空のときのみ)。
 */
async function propagateReason(
  sb: ReturnType<typeof getSupabaseServer>,
  oppId: string,
  toYomi: string | null,
  reason: string,
): Promise<void> {
  if (toYomi === "0.受注") {
    await sb.from("opportunities").update({ win_reason: reason }).eq("id", oppId).or("win_reason.is.null,win_reason.eq.");
  } else if (toYomi === "7.オチ") {
    await sb.from("opportunities").update({ lost_reason: reason }).eq("id", oppId).or("lost_reason.is.null,lost_reason.eq.");
  }
}

/** ヨミ変更履歴の1件に要因を記入(未記入キューからの後追い記入・編集)。 */
export async function fillYomiReasonAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const logId = String(formData.get("log_id") ?? "").trim();
  const qs = new URLSearchParams();
  for (const k of ["days", "owner", "missing"]) {
    const v = String(formData.get(`back_${k}`) ?? "").trim();
    if (v) qs.set(k, v);
  }
  const back = (q: string) => redirect(`/app/reviews/yomi-history?${qs.size ? `${qs}&` : ""}${q}`);
  if (!logId) back("error=invalid");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) back("error=empty_reason");

  const sb = getSupabaseServer();
  const logR = await sb.from("yomi_change_logs").select("id, opportunity_id, to_yomi").eq("id", logId).maybeSingle();
  if (logR.error || !logR.data) back("error=save_failed");
  const log = logR.data as { id: string; opportunity_id: string; to_yomi: string | null };

  const up = await sb
    .from("yomi_change_logs")
    .update({ reason, reason_filled_at: new Date().toISOString(), reason_by: ctx.userId })
    .eq("id", logId);
  if (up.error) back("error=save_failed");

  await propagateReason(sb, log.opportunity_id, log.to_yomi, reason);

  revalidatePath("/app/reviews/yomi-history");
  revalidatePath("/app/analytics/winloss");
  back("saved=reason");
}

/**
 * ヨミ変更直後の要因記入(週報一覧などの同時入力用)。
 * 対象案件の最新のヨミ変更ログ(to_yomiが一致)に要因を書き込む。
 */
export async function attachReasonToLatestYomiLog(oppId: string, toYomi: string | null, reason: string): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const logR = await sb
    .from("yomi_change_logs")
    .select("id, to_yomi")
    .eq("opportunity_id", oppId)
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (logR.error || !logR.data) return;
  const log = logR.data as { id: string; to_yomi: string | null };
  if ((log.to_yomi ?? null) !== (toYomi ?? null)) return; // 直近ログが今回の変更でなければ触らない
  await sb
    .from("yomi_change_logs")
    .update({ reason, reason_filled_at: new Date().toISOString(), reason_by: ctx.userId })
    .eq("id", log.id);
  await propagateReason(sb, oppId, toYomi, reason);
}
