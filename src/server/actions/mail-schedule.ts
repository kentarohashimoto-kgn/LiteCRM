"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { isValidEmail } from "@/lib/email";
import { validateScheduleAt } from "@/lib/schedule";
import { logAudit, clientIp } from "@/lib/audit-events";

/**
 * メールの予約送信(0179)。作成時は送らず内容を保持し、指定時刻に
 * /api/cron/scheduled-mail が本人アカウントで送信する。
 * 予約の作成・日時変更・キャンセルは本人のみ(RLSでも sender_user_id = auth.uid() で制限)。
 */

const SEND_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales", "partner", "inside_sales"];

export interface ScheduleEmailInput {
  scheduledAtIso: string;
  toAddr: string;
  subject: string;
  body: string;
  contactId?: string | null;
  accountId?: string | null;
  opportunityId?: string | null;
  leadId?: string | null;
  templateId?: string | null;
  mailBatchId?: string | null;
  unsubscribeFooter?: boolean;
  createActivity?: boolean;
}

export type ScheduleResult = { ok: true; id: string } | { ok: false; error: string };

/** 1通の予約送信を登録する。 */
export async function scheduleEmailAction(input: ScheduleEmailInput): Promise<ScheduleResult> {
  const ctx = await requireCtx();
  if (ctx.isPresentation) return { ok: false, error: "プレゼンモード中はメールを予約できません" };
  if (!SEND_ROLES.includes(ctx.role)) return { ok: false, error: "送信権限がありません" };
  if (!isValidEmail(input.toAddr)) return { ok: false, error: "宛先メールアドレスが正しくありません" };
  if (!input.subject.trim() && !input.body.trim()) return { ok: false, error: "件名または本文を入力してください" };
  const v = validateScheduleAt(input.scheduledAtIso, Date.now());
  if (!v.ok) return { ok: false, error: v.error };

  const sb = getSupabaseServer();
  // 送信時に本人アカウントが必要。未接続なら予約しても送れないので事前に弾く
  const { data: acc } = await sb.from("user_mail_accounts").select("status").eq("user_id", ctx.userId).maybeSingle();
  if (!acc || acc.status !== "active") {
    return { ok: false, error: "送信メールアカウントが未接続です。[メール設定]から接続してください。" };
  }
  // 配信停止済みの宛先には予約もしない
  const { data: sup } = await sb.from("mail_suppressions").select("id").eq("email", input.toAddr.trim().toLowerCase()).maybeSingle();
  if (sup) return { ok: false, error: "この宛先は配信停止済みです（本人の希望により送信できません）" };

  const { data, error } = await sb.from("scheduled_emails").insert({
    tenant_id: ctx.tenantId,
    scheduled_at: input.scheduledAtIso,
    sender_user_id: ctx.userId,
    to_addr: input.toAddr.trim(),
    subject: input.subject,
    body: input.body,
    contact_id: input.contactId ?? null,
    account_id: input.accountId ?? null,
    opportunity_id: input.opportunityId ?? null,
    lead_id: input.leadId ?? null,
    template_id: input.templateId ?? null,
    mail_batch_id: input.mailBatchId ?? null,
    unsubscribe_footer: !!input.unsubscribeFooter,
    create_activity: input.createActivity !== false,
    created_by: ctx.userId,
  }).select("id").single();
  if (error || !data) return { ok: false, error: `予約に失敗しました: ${error?.message ?? ""}` };

  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "mail.schedule", target: input.toAddr, meta: { at: input.scheduledAtIso }, ip: clientIp() });
  revalidatePath("/app/email/scheduled");
  return { ok: true, id: data.id as string };
}

export interface ScheduledRow {
  id: string;
  scheduledAt: string;
  status: string;
  toAddr: string;
  subject: string;
  body: string;
  senderUserId: string;
  isMine: boolean;
  batchTitle: string | null;
  sentAt: string | null;
  errorText: string | null;
}

/** 予約一覧(送信予定・送信済み・失敗)。 */
export async function listScheduledEmailsAction(): Promise<ScheduledRow[]> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("scheduled_emails")
    .select("id, scheduled_at, status, to_addr, subject, body, sender_user_id, sent_at, error_text, lead_mail_batches(title)")
    .order("scheduled_at", { ascending: true })
    .limit(300);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, scheduledAt: r.scheduled_at, status: r.status, toAddr: r.to_addr,
    subject: r.subject ?? "", body: r.body ?? "", senderUserId: r.sender_user_id,
    isMine: r.sender_user_id === ctx.userId,
    batchTitle: (r.lead_mail_batches?.title as string) ?? null,
    sentAt: r.sent_at ?? null, errorText: r.error_text ?? null,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 予約のキャンセル(送信前のみ)。 */
export async function cancelScheduledEmailAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("scheduled_emails")
    .update({ status: "canceled" })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) return { ok: false, error: error.message };
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "mail.schedule_cancel", target: id, ip: clientIp() });
  revalidatePath("/app/email/scheduled");
  return { ok: true };
}

/** 予約日時の変更(送信前のみ)。 */
export async function rescheduleEmailAction(id: string, scheduledAtIso: string): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const v = validateScheduleAt(scheduledAtIso, Date.now());
  if (!v.ok) return { ok: false, error: v.error };
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("scheduled_emails")
    .update({ scheduled_at: scheduledAtIso })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/email/scheduled");
  return { ok: true };
}

/** 予約中の件数(画面バッジ用)。 */
export async function countScheduledEmailsAction(): Promise<number> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { count } = await sb.from("scheduled_emails").select("id", { count: "exact", head: true }).eq("status", "scheduled");
  return count ?? 0;
}
