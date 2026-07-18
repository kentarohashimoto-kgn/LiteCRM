"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { sendMail } from "@/lib/mail-smtp";
import { emailSnippet, isValidEmail } from "@/lib/email";
import { buildLinkTokens, buildTrackedHtml, randomToken } from "@/lib/email-tracking";

const SEND_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales", "partner"];

export interface SendEmailInput {
  contactId: string | null;
  accountId: string | null;
  opportunityId: string | null;
  templateId: string | null;
  toAddr: string;
  subject: string;
  body: string;
}
export type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * WO-22 本人アカウント(SMTP)からメールを送信し、開封/クリック計測を仕込む(F-101b/c)。
 * 送信ボタンが人の関所。送信物は本人のSentにも残り、システムにも email_messages が残る。
 *  1. 開封トークン + 本文URLごとのクリックトークンを発行
 *  2. activities(email) と email_messages(status=queued) を記録、email_links を作成
 *  3. トラッキング入りHTMLを組み立ててSMTP送信
 *  4. 結果で status=sent/failed を更新
 */
export async function sendEmailViaSmtpAction(input: SendEmailInput): Promise<SendEmailResult> {
  const ctx = await requireCtx();
  if (!SEND_ROLES.includes(ctx.role)) return { ok: false, error: "送信権限がありません" };
  if (!mailCredSecretConfigured()) return { ok: false, error: "サーバーに MAIL_CRED_SECRET が未設定です（管理者に連絡してください）" };
  if (!isValidEmail(input.toAddr)) return { ok: false, error: "宛先メールアドレスが正しくありません" };
  if (!input.subject.trim() && !input.body.trim()) return { ok: false, error: "件名または本文を入力してください" };

  const sb = getSupabaseServer();

  // 送信アカウント(本人)
  const { data: acc } = await sb
    .from("user_mail_accounts")
    .select("smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_enc, from_email, from_name, bcc_self, status")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!acc || acc.status !== "active") {
    return { ok: false, error: "送信メールアカウントが未接続です。[メール設定]から接続してください。" };
  }

  const now = new Date().toISOString();
  const openToken = randomToken();
  const linkTokens = buildLinkTokens(input.body);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  // タイムライン活動(type='email')
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
        title: `メール送信: ${input.subject.trim() || "(件名なし)"}`.slice(0, 80),
        body: input.body.trim() || null,
        activity_at: now,
      })
      .select("id")
      .single();
    activityId = (act?.id as string) ?? null;
  }

  // email_messages(送信前=queued)
  const { data: msg, error: msgErr } = await sb
    .from("email_messages")
    .insert({
      tenant_id: ctx.tenantId,
      direction: "out",
      subject: input.subject.trim() || null,
      snippet: emailSnippet(input.body),
      to_addrs: [input.toAddr],
      from_addr: acc.from_email as string,
      contact_id: input.contactId,
      account_id: input.accountId,
      opportunity_id: input.opportunityId,
      template_id: input.templateId,
      activity_id: activityId,
      source: "compose",
      sent_via: "smtp",
      status: "queued",
      track_token: openToken,
      sent_at: now,
      logged_by: ctx.userId,
    })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: "記録に失敗しました: " + (msgErr?.message ?? "") };
  const messageId = msg.id as string;

  // クリック計測リンク
  if (linkTokens.length) {
    await sb.from("email_links").insert(
      linkTokens.map((l) => ({
        tenant_id: ctx.tenantId,
        email_message_id: messageId,
        token: l.token,
        url: l.url,
      })),
    );
  }

  // トラッキング入りHTMLを組み立てて送信
  const html = buildTrackedHtml({ bodyText: input.body, baseUrl, openToken, linkTokens });
  let plain = "";
  try {
    plain = decryptSecret(acc.smtp_password_enc as string);
  } catch {
    await sb.from("email_messages").update({ status: "failed", error_text: "資格情報の復号に失敗（MAIL_CRED_SECRETの不一致の可能性）" }).eq("id", messageId);
    return { ok: false, error: "送信資格情報の復号に失敗しました。管理者に連絡してください。" };
  }

  const sent = await sendMail(
    {
      host: acc.smtp_host as string,
      port: acc.smtp_port as number,
      secure: acc.smtp_secure as boolean,
      username: acc.smtp_username as string,
      password: plain,
      fromEmail: acc.from_email as string,
      fromName: acc.from_name as string | null,
    },
    {
      to: input.toAddr,
      subject: input.subject,
      text: input.body,
      html,
      bcc: acc.bcc_self ? (acc.from_email as string) : null,
    },
  );

  if (!sent.ok) {
    await sb.from("email_messages").update({ status: "failed", error_text: sent.error.slice(0, 500) }).eq("id", messageId);
    return { ok: false, error: "送信に失敗しました: " + sent.error };
  }

  await sb.from("email_messages").update({ status: "sent" }).eq("id", messageId);

  // タイムラインの鮮度
  if (input.opportunityId) {
    await sb.from("opportunities").update({ last_activity_at: now }).eq("id", input.opportunityId);
    revalidatePath(`/app/opportunities/${input.opportunityId}`);
  }
  if (input.accountId) {
    await sb.from("accounts").update({ last_activity_date: now.slice(0, 10) }).eq("id", input.accountId);
  }
  revalidatePath("/app/email/history");
  revalidatePath("/app/activities");
  return { ok: true, id: messageId };
}
