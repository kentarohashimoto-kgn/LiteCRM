/**
 * WO-21/22 メール配信の共通コア(F-101b/c)。
 * 対話送信(mail-send.ts / ユーザーRLSクライアント)とシーケンスcron(service roleクライアント)
 * の両方から使う。トラッキング(開封ピクセル/クリックラップ)を仕込み、本人アカウントの
 * SMTPで送信し、email_messages / email_links / activities(任意) に記録する。
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMail, type SmtpAccount } from "@/lib/mail-smtp";
import { emailSnippet } from "@/lib/email";
import { buildLinkTokens, buildTrackedHtml, randomToken } from "@/lib/email-tracking";

export interface DeliverParams {
  tenantId: string;
  loggedBy: string; // 記録者=送信アカウントの持ち主(activities.owner_user_id にも使用)
  account: SmtpAccount;
  bccSelf?: boolean;
  to: string;
  subject: string;
  body: string;
  contactId?: string | null;
  accountId?: string | null;
  opportunityId?: string | null;
  templateId?: string | null;
  sequenceEnrollmentId?: string | null;
  sequenceStep?: number | null;
  createActivity?: boolean; // タイムライン活動(type='email')も作るか
  baseUrl: string;
}

export type DeliverResult = { ok: true; id: string } | { ok: false; error: string; id?: string };

/**
 * 1通を配信して記録する。失敗時は email_messages.status='failed' に更新して error を返す。
 */
export async function deliverTrackedEmail(sb: SupabaseClient, p: DeliverParams): Promise<DeliverResult> {
  const now = new Date().toISOString();
  const openToken = randomToken();
  const linkTokens = buildLinkTokens(p.body);

  // タイムライン活動(任意・accountId必須)
  let activityId: string | null = null;
  if (p.createActivity && p.accountId) {
    const { data: act } = await sb
      .from("activities")
      .insert({
        tenant_id: p.tenantId,
        account_id: p.accountId,
        contact_id: p.contactId ?? null,
        opportunity_id: p.opportunityId ?? null,
        owner_user_id: p.loggedBy,
        activity_type: "email",
        title: `メール送信: ${p.subject.trim() || "(件名なし)"}`.slice(0, 80),
        body: p.body.trim() || null,
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
      tenant_id: p.tenantId,
      direction: "out",
      subject: p.subject.trim() || null,
      snippet: emailSnippet(p.body),
      to_addrs: [p.to],
      from_addr: p.account.fromEmail,
      contact_id: p.contactId ?? null,
      account_id: p.accountId ?? null,
      opportunity_id: p.opportunityId ?? null,
      template_id: p.templateId ?? null,
      activity_id: activityId,
      source: "compose",
      sent_via: "smtp",
      status: "queued",
      track_token: openToken,
      sequence_enrollment_id: p.sequenceEnrollmentId ?? null,
      sequence_step: p.sequenceStep ?? null,
      sent_at: now,
      logged_by: p.loggedBy,
    })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: "記録に失敗しました: " + (msgErr?.message ?? "") };
  const messageId = msg.id as string;

  // クリック計測リンク
  if (linkTokens.length) {
    await sb.from("email_links").insert(
      linkTokens.map((l) => ({ tenant_id: p.tenantId, email_message_id: messageId, token: l.token, url: l.url })),
    );
  }

  // 送信
  const html = buildTrackedHtml({ bodyText: p.body, baseUrl: p.baseUrl, openToken, linkTokens });
  const sent = await sendMail(p.account, {
    to: p.to,
    subject: p.subject,
    text: p.body,
    html,
    bcc: p.bccSelf ? p.account.fromEmail : null,
  });

  if (!sent.ok) {
    await sb.from("email_messages").update({ status: "failed", error_text: sent.error.slice(0, 500) }).eq("id", messageId);
    return { ok: false, error: sent.error, id: messageId };
  }
  // 送信時の RFC Message-Id を保存(受信同期WO-24で返信照合に使う)
  await sb.from("email_messages").update({ status: "sent", smtp_message_id: sent.messageId || null }).eq("id", messageId);

  // タイムラインの鮮度
  if (p.opportunityId) await sb.from("opportunities").update({ last_activity_at: now }).eq("id", p.opportunityId);
  if (p.accountId) await sb.from("accounts").update({ last_activity_date: now.slice(0, 10) }).eq("id", p.accountId);

  return { ok: true, id: messageId };
}
