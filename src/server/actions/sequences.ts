"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { validateSteps, stepDueDate, jstToday, type SequenceStep, type StopOn } from "@/lib/sequences";
import { logAudit, clientIp } from "@/lib/audit-events";

const EDIT_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales", "partner"];

/** WO-21 シーケンス定義のCRUD・投入・停止(F-101b)。 */

export async function saveSequenceAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/sequences?${q}`);
  if (!EDIT_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  // steps: template_id[] と wait_days[] を対で受け取る
  const templateIds = formData.getAll("step_template").map((v) => String(v));
  const waitDays = formData.getAll("step_wait").map((v) => parseInt(String(v) || "0", 10));
  const steps: SequenceStep[] = templateIds
    .map((t, i) => ({ template_id: t, wait_days: Number.isFinite(waitDays[i]) ? waitDays[i] : 0 }))
    .filter((s) => s.template_id);
  const stopOn: StopOn = {
    on_won: formData.get("on_won") === "on",
    on_lost: formData.get("on_lost") === "on",
    on_appointment: formData.get("on_appointment") === "on",
  };
  if (!name) back("error=invalid");
  if (!validateSteps(steps)) back("error=need_steps");

  const sb = getSupabaseServer();
  const row = { tenant_id: ctx.tenantId, name, description, steps, stop_on: stopOn };
  const res = id
    ? await sb.from("email_sequences").update(row).eq("id", id).eq("tenant_id", ctx.tenantId).select("id")
    : await sb.from("email_sequences").insert({ ...row, created_by: ctx.userId }).select("id");
  if (res.error) back("error=save_failed");
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "sequence.create", target: name, meta: { steps: steps.length, update: !!id }, ip: clientIp() });
  revalidatePath("/app/email/sequences");
  back(id ? "saved=updated" : "saved=created");
}

export async function archiveSequenceAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/sequences?${q}`);
  if (!EDIT_ROLES.includes(ctx.role)) back("error=forbidden");
  const id = String(formData.get("id") ?? "").trim();
  const to = String(formData.get("to") ?? "archived");
  if (!id) back("error=invalid");
  const sb = getSupabaseServer();
  await sb.from("email_sequences").update({ status: to === "active" ? "active" : "archived" }).eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/email/sequences");
  back("saved=updated");
}

export interface EnrollInput {
  sequenceId: string;
  contactId: string | null;
  accountId: string | null;
  opportunityId: string | null;
  toAddr: string;
}
export type EnrollResult = { ok: true; id: string } | { ok: false; error: string };

/** 案件/担当者をシーケンスに投入する。先頭ステップの送信予定日を設定。 */
export async function enrollSequenceAction(input: EnrollInput): Promise<EnrollResult> {
  const ctx = await requireCtx();
  if (!EDIT_ROLES.includes(ctx.role)) return { ok: false, error: "権限がありません" };
  if (!input.sequenceId || !input.toAddr) return { ok: false, error: "シーケンスと宛先を指定してください" };
  const sb = getSupabaseServer();

  const { data: seq } = await sb.from("email_sequences").select("id, steps, status").eq("id", input.sequenceId).maybeSingle();
  if (!seq || seq.status !== "active") return { ok: false, error: "有効なシーケンスが見つかりません" };
  const steps = (seq.steps as SequenceStep[]) ?? [];
  if (!steps.length) return { ok: false, error: "ステップが未設定のシーケンスです" };

  const today = jstToday(Date.now());
  const due = stepDueDate(today, steps[0]);

  const { data, error } = await sb
    .from("sequence_enrollments")
    .insert({
      tenant_id: ctx.tenantId,
      sequence_id: input.sequenceId,
      contact_id: input.contactId,
      account_id: input.accountId,
      opportunity_id: input.opportunityId,
      to_addr: input.toAddr,
      status: "active",
      current_step: 0,
      next_due_date: due,
      enrolled_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    // 二重投入(unique違反)は分かりやすく返す
    if (String(error.code) === "23505") return { ok: false, error: "この宛先は既にこのシーケンスに投入済みです" };
    return { ok: false, error: "投入に失敗しました: " + error.message };
  }
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "sequence.enroll", target: input.toAddr, meta: { sequence_id: input.sequenceId }, ip: clientIp() });
  revalidatePath("/app/email/sequences");
  return { ok: true, id: data!.id as string };
}

export async function stopEnrollmentAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/sequences?${q}`);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("error=invalid");
  const sb = getSupabaseServer();
  await sb
    .from("sequence_enrollments")
    .update({ status: "stopped", stopped_reason: "手動停止" })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "sequence.stop", target: id, ip: clientIp() });
  revalidatePath("/app/email/sequences");
  back("saved=stopped");
}
