"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PROJECT_ROLES } from "@/lib/constants";
import { weekStartOf, addDaysISO, parseHoursInput } from "@/lib/work-time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normWeek(v: string): string | null {
  return DATE_RE.test(v) ? weekStartOf(v) : null;
}

/**
 * 週の記入行を保存(洗い替え)。提出済み/承認済みの週はロック(RLSでも二重に担保)。
 * 結果は ?saved= / ?error= でリダイレクト通知。
 */
export async function saveWorkWeekAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const planId = String(formData.get("plan_id") ?? "").trim();
  const week = normWeek(String(formData.get("week_start") ?? ""));
  const back = (q: string) => redirect(`/app/work${week ? `?week=${week}&${q}` : `?${q}`}`);
  if (!assignmentId || !planId || !week) back("error=invalid");

  const sb = getSupabaseServer();
  const wk = await sb.from("work_weeks").select("id, status").eq("assignment_id", assignmentId).eq("week_start", week!).maybeSingle();
  if (wk.error) back("error=load_failed");
  const status = wk.data?.status as string | undefined;
  if (status === "submitted" || status === "approved") back("error=locked");

  const dates = formData.getAll("e_date").map(String);
  const hoursArr = formData.getAll("e_hours").map((v) => parseHoursInput(String(v)));
  const tasks = formData.getAll("e_task").map(String);
  const outcomes = formData.getAll("e_outcome").map(String);
  const nexts = formData.getAll("e_next").map(String);
  const risks = formData.getAll("e_risk").map(String);
  const memos = formData.getAll("e_memo").map(String);

  const weekEnd = addDaysISO(week!, 6);
  const t = (s?: string) => (s ?? "").trim() || null;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (!DATE_RE.test(d) || d < week! || d > weekEnd) continue;
    const row = {
      tenant_id: ctx.tenantId,
      plan_id: planId,
      assignment_id: assignmentId,
      work_date: d,
      week_start: week!,
      hours: hoursArr[i] ?? 0,
      task_text: t(tasks[i]),
      outcome_text: t(outcomes[i]),
      next_action_text: t(nexts[i]),
      risk_text: t(risks[i]),
      memo: t(memos[i]),
      created_by: ctx.userId,
    };
    // 完全な空行はスキップ
    if (!row.hours && !row.task_text && !row.outcome_text && !row.next_action_text && !row.risk_text && !row.memo) continue;
    rows.push(row);
  }

  // 洗い替え(RLS: 本人の行のみ・ロック週は不可)
  const del = await sb.from("work_entries").delete().eq("assignment_id", assignmentId).eq("week_start", week!);
  if (del.error) back("error=save_failed");
  if (rows.length) {
    const ins = await sb.from("work_entries").insert(rows);
    if (ins.error) back("error=save_failed");
  }
  // 週の状態行が無ければ下書きとして作成
  if (!wk.data) {
    const insW = await sb.from("work_weeks").insert({
      tenant_id: ctx.tenantId,
      plan_id: planId,
      assignment_id: assignmentId,
      week_start: week!,
      created_by: ctx.userId,
    });
    if (insW.error) back("error=save_failed");
  }
  revalidatePath("/app/work");
  back("saved=work");
}

/** 週を提出(承認依頼)。提出後は承認/差戻しまで編集ロック。 */
export async function submitWorkWeekAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const planId = String(formData.get("plan_id") ?? "").trim();
  const week = normWeek(String(formData.get("week_start") ?? ""));
  const back = (q: string) => redirect(`/app/work${week ? `?week=${week}&${q}` : `?${q}`}`);
  if (!assignmentId || !planId || !week) back("error=invalid");

  const sb = getSupabaseServer();
  const cnt = await sb.from("work_entries").select("id", { count: "exact", head: true }).eq("assignment_id", assignmentId).eq("week_start", week!);
  if (cnt.error) back("error=load_failed");
  if (!cnt.count) back("error=empty");

  const wk = await sb.from("work_weeks").select("id, status").eq("assignment_id", assignmentId).eq("week_start", week!).maybeSingle();
  if (wk.error) back("error=load_failed");
  if (wk.data?.status === "approved") back("error=locked");

  if (wk.data) {
    const up = await sb.from("work_weeks").update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
    }).eq("id", wk.data.id);
    if (up.error) back("error=save_failed");
  } else {
    const ins = await sb.from("work_weeks").insert({
      tenant_id: ctx.tenantId,
      plan_id: planId,
      assignment_id: assignmentId,
      week_start: week!,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      created_by: ctx.userId,
    });
    if (ins.error) back("error=save_failed");
  }
  revalidatePath("/app/work");
  revalidatePath("/app/projects/approvals");
  back("saved=submit");
}

/** 週を承認(管理職)。承認済み実績が原価管理・月次請求の元データになる。 */
export async function approveWorkWeekAction(formData: FormData): Promise<void> {
  await reviewWorkWeek(formData, "approved", "saved=approve");
}

/** 週を差戻し(管理職)。記入者は修正して再提出できる。 */
export async function returnWorkWeekAction(formData: FormData): Promise<void> {
  await reviewWorkWeek(formData, "returned", "saved=return");
}

async function reviewWorkWeek(formData: FormData, status: "approved" | "returned", savedQ: string): Promise<void> {
  const ctx = await requireCtx();
  const id = String(formData.get("week_id") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const back = (q: string) => redirect(`/app/projects/approvals${month ? `?month=${month}&${q}` : `?${q}`}`);
  if (!PROJECT_ROLES.includes(ctx.role)) back("error=forbidden");
  if (!id) back("error=invalid");

  const sb = getSupabaseServer();
  const note = String(formData.get("review_note") ?? "").trim() || null;
  const up = await sb.from("work_weeks").update({
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: ctx.userId,
    review_note: note,
  }).eq("id", id).eq("status", "submitted").select("id");
  if (up.error) back("error=save_failed");
  if (!up.data?.length) back("error=not_pending");

  revalidatePath("/app/projects/approvals");
  revalidatePath("/app/projects");
  revalidatePath("/app/work");
  back(savedQ);
}
