"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { emailSnippet } from "@/lib/email";

const EDIT_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales", "partner"];

/**
 * WO-20 メール連携(F-101a)のサーバー操作。
 * ・email_templates の CRUD(定型文)
 * ・compose 用の担当者(メールあり)検索
 * ・logEmailAction: 送信メールを email_messages + activities(type='email') に記録
 * 送信自体は Gmail 作成画面(クライアントで window.open)で人が行う=確定原則(送信は手動)。
 */

// ---- テンプレート CRUD -----------------------------------------------------
export async function createEmailTemplateAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/templates?${q}`);
  if (!EDIT_ROLES.includes(ctx.role)) back("error=forbidden");

  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "other").trim();
  const subject = String(formData.get("subject_tmpl") ?? "");
  const body = String(formData.get("body_tmpl") ?? "");
  if (!name) back("error=invalid");

  const sb = getSupabaseServer();
  const ins = await sb.from("email_templates").insert({
    tenant_id: ctx.tenantId,
    name,
    category,
    subject_tmpl: subject,
    body_tmpl: body,
    created_by: ctx.userId,
  });
  if (ins.error) back("error=save_failed");
  revalidatePath("/app/email/templates");
  back("saved=created");
}

export async function updateEmailTemplateAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/templates?${q}`);
  if (!EDIT_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "other").trim();
  const subject = String(formData.get("subject_tmpl") ?? "");
  const body = String(formData.get("body_tmpl") ?? "");
  if (!id || !name) back("error=invalid");

  const sb = getSupabaseServer();
  const up = await sb
    .from("email_templates")
    .update({ name, category, subject_tmpl: subject, body_tmpl: body })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (up.error || !up.data?.length) back("error=save_failed");
  revalidatePath("/app/email/templates");
  back("saved=updated");
}

export async function deleteEmailTemplateAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/email/templates?${q}`);
  if (!EDIT_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("error=invalid");

  const sb = getSupabaseServer();
  const del = await sb.from("email_templates").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (del.error) back("error=save_failed");
  revalidatePath("/app/email/templates");
  back("saved=deleted");
}

// ---- compose 用の検索 ------------------------------------------------------
export interface ContactPick {
  id: string;
  name: string;
  email: string | null;
  account_id: string | null;
  account_name: string | null;
}

/** メールアドレスを持つ担当者を検索(compose の宛先選択)。上位20件。 */
export async function searchContactsWithEmailAction(q: string): Promise<ContactPick[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  let query = sb
    .from("contacts")
    .select("id, name, email, account_id, accounts(name)")
    .not("email", "is", null)
    .order("name")
    .limit(20);
  if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
  const { data } = await query;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string) ?? "—",
    email: (c.email as string) ?? null,
    account_id: (c.account_id as string) ?? null,
    account_name: ((c.accounts as unknown as { name: string } | null)?.name as string) ?? null,
  }));
}

// ---- メール送信の記録 ------------------------------------------------------
export interface LogEmailInput {
  contactId: string | null;
  accountId: string | null;
  opportunityId: string | null;
  templateId: string | null;
  toAddr: string | null;
  subject: string;
  body: string;
}
export type LogEmailResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * 送信したメールを記録する。email_messages に1行、あわせて activities(type='email')
 * にも1行入れてタイムラインへ反映。関連案件の最終活動日時も更新する。
 * ※ 実際の送信は Gmail 作成画面で人が行う。ここは「送った/送る記録」を残すだけ。
 */
export async function logEmailAction(input: LogEmailInput): Promise<LogEmailResult> {
  const ctx = await requireCtx();
  if (!EDIT_ROLES.includes(ctx.role)) return { ok: false, error: "権限がありません" };
  if (!input.subject.trim() && !input.body.trim()) return { ok: false, error: "件名または本文を入力してください" };
  const sb = getSupabaseServer();
  const now = new Date().toISOString();
  const title = `メール送信: ${input.subject.trim() || "(件名なし)"}`.slice(0, 80);

  // タイムライン活動(type='email')。account があれば紐付ける。
  let activityId: string | null = null;
  if (input.accountId) {
    const { data: act } = await sb
      .from("activities")
      .insert({
        tenant_id: ctx.tenantId,
        account_id: input.accountId,
        contact_id: input.contactId,
        opportunity_id: input.opportunityId,
        owner_user_id: ctx.userId,
        activity_type: "email",
        title,
        body: input.body.trim() || null,
        activity_at: now,
      })
      .select("id")
      .single();
    activityId = (act?.id as string) ?? null;
  }

  const { data: msg, error } = await sb
    .from("email_messages")
    .insert({
      tenant_id: ctx.tenantId,
      direction: "out",
      subject: input.subject.trim() || null,
      snippet: emailSnippet(input.body),
      to_addrs: input.toAddr ? [input.toAddr] : [],
      contact_id: input.contactId,
      account_id: input.accountId,
      opportunity_id: input.opportunityId,
      template_id: input.templateId,
      activity_id: activityId,
      source: "compose",
      sent_at: now,
      logged_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !msg) return { ok: false, error: "記録に失敗しました: " + (error?.message ?? "") };

  // 関連案件・顧客の最終活動を更新(タイムラインの鮮度)
  if (input.opportunityId) {
    await sb.from("opportunities").update({ last_activity_at: now }).eq("id", input.opportunityId);
    revalidatePath(`/app/opportunities/${input.opportunityId}`);
  }
  if (input.accountId) {
    await sb.from("accounts").update({ last_activity_date: now.slice(0, 10) }).eq("id", input.accountId);
  }
  revalidatePath("/app/activities");
  return { ok: true, id: msg.id as string };
}
