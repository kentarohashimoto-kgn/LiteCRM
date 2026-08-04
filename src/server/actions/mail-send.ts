"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { isValidEmail } from "@/lib/email";
import { deliverTrackedEmail } from "@/lib/mail-deliver";
import { refreshAccessToken } from "@/lib/google-oauth";
import { logAudit, clientIp } from "@/lib/audit-events";

const SEND_ROLES = ["owner", "admin", "sales_manager", "sales_rep", "external_sales", "partner", "inside_sales"];

export interface SendEmailInput {
  contactId: string | null;
  accountId: string | null;
  opportunityId: string | null;
  templateId: string | null;
  toAddr: string;
  subject: string;
  body: string;
  /** 配信停止リンクを本文末尾に付ける。個別送信は既定OFF(業務連絡として自然な文面にするため)。
   *  サービス紹介・セミナー勧誘など広告宣伝が主目的の内容ではONを推奨(特定電子メール法の表示義務)。 */
  unsubscribeFooter?: boolean;
}
export type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * WO-22/25 本人アカウント(SMTP or Gmail API)からメール送信し、開封/クリック計測を仕込む。
 * 送信ボタンが人の関所。実配信・記録は共通コア deliverTrackedEmail に委譲。
 */
export async function sendEmailViaSmtpAction(input: SendEmailInput): Promise<SendEmailResult> {
  const ctx = await requireCtx();
  if (ctx.isPresentation) return { ok: false, error: "プレゼンモード中はメール送信できません（デモ用データのため実送信を抑止しています）。" };
  if (!SEND_ROLES.includes(ctx.role)) return { ok: false, error: "送信権限がありません" };
  if (!mailCredSecretConfigured()) return { ok: false, error: "サーバーに MAIL_CRED_SECRET が未設定です（管理者に連絡してください）" };
  if (!isValidEmail(input.toAddr)) return { ok: false, error: "宛先メールアドレスが正しくありません" };
  if (!input.subject.trim() && !input.body.trim()) return { ok: false, error: "件名または本文を入力してください" };

  const sb = getSupabaseServer();
  // 配信停止(サプレッション)突合: 停止済み宛先には個別送信もしない(特電法対応)
  const { data: sup } = await sb.from("mail_suppressions").select("id").eq("email", input.toAddr.trim().toLowerCase()).maybeSingle();
  if (sup) return { ok: false, error: "この宛先は配信停止済みです（本人の希望により送信できません）" };

  const { data: acc } = await sb
    .from("user_mail_accounts")
    .select("auth_method, smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_enc, oauth_refresh_token_enc, oauth_email, from_email, from_name, bcc_self, status")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!acc || acc.status !== "active") return { ok: false, error: "送信メールアカウントが未接続です。[メール設定]から接続してください。" };

  const common = {
    tenantId: ctx.tenantId, loggedBy: ctx.userId,
    bccSelf: acc.bcc_self as boolean,
    to: input.toAddr, subject: input.subject, body: input.body,
    contactId: input.contactId, accountId: input.accountId, opportunityId: input.opportunityId, templateId: input.templateId,
    createActivity: true, unsubscribeFooter: !!input.unsubscribeFooter,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL || "",
  };

  let res;
  if (acc.auth_method === "google_oauth") {
    let refresh = "";
    try { refresh = decryptSecret(acc.oauth_refresh_token_enc as string); }
    catch { return { ok: false, error: "Google認証情報の復号に失敗しました。" }; }
    const tok = await refreshAccessToken(refresh);
    if (!tok.ok) return { ok: false, error: "Googleトークンの更新に失敗しました（再接続してください）: " + tok.error };
    res = await deliverTrackedEmail(sb, {
      ...common,
      from: { email: (acc.oauth_email as string) || (acc.from_email as string), name: acc.from_name as string | null },
      authMethod: "google_oauth", oauthAccessToken: tok.accessToken,
    });
  } else {
    let password = "";
    try { password = decryptSecret(acc.smtp_password_enc as string); }
    catch { return { ok: false, error: "送信資格情報の復号に失敗しました。" }; }
    res = await deliverTrackedEmail(sb, {
      ...common,
      from: { email: acc.from_email as string, name: acc.from_name as string | null },
      authMethod: "smtp",
      smtp: { host: acc.smtp_host as string, port: acc.smtp_port as number, secure: acc.smtp_secure as boolean, username: acc.smtp_username as string, password, fromEmail: acc.from_email as string, fromName: acc.from_name as string | null },
    });
  }

  if (!res.ok) return { ok: false, error: "送信に失敗しました: " + res.error };
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "mail.send", target: input.toAddr, meta: { via: acc.auth_method, opportunity_id: input.opportunityId }, ip: await clientIp() });
  if (input.opportunityId) revalidatePath(`/app/opportunities/${input.opportunityId}`);
  revalidatePath("/app/email/history");
  revalidatePath("/app/activities");
  return { ok: true, id: res.id };
}
