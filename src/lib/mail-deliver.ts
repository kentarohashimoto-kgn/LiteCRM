/**
 * WO-21/22/25 メール配信の共通コア(F-101b/c)。
 * 対話送信(mail-send.ts)・シーケンスcron・から使う。トラッキング(開封ピクセル/クリック
 * ラップ)を仕込み、本人アカウントの SMTP(アプリパスワード) または Gmail API(OAuth) で
 * 送信し、email_messages / email_links / activities(任意) に記録する。
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMail, type SmtpAccount } from "@/lib/mail-smtp";
import { sendGmail } from "@/lib/gmail-api";
import { buildMime } from "@/lib/mime";
import { emailSnippet } from "@/lib/email";
import { buildLinkTokens, buildTrackedHtml, randomToken } from "@/lib/email-tracking";
import { normalizeMessageId } from "@/lib/inbound-match";

export interface DeliverParams {
  tenantId: string;
  loggedBy: string;
  from: { email: string; name?: string | null };
  authMethod: "smtp" | "google_oauth";
  smtp?: SmtpAccount;            // authMethod='smtp' の時に必須
  oauthAccessToken?: string;     // authMethod='google_oauth' の時に必須
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
  createActivity?: boolean;
  baseUrl: string;
}

export type DeliverResult = { ok: true; id: string } | { ok: false; error: string; id?: string };

export async function deliverTrackedEmail(sb: SupabaseClient, p: DeliverParams): Promise<DeliverResult> {
  const now = new Date().toISOString();
  const openToken = randomToken();
  const linkTokens = buildLinkTokens(p.body);
  const messageId = `<${randomToken(16)}@catorce-sales-os>`;

  // タイムライン活動(任意)
  let activityId: string | null = null;
  if (p.createActivity && p.accountId) {
    const { data: act } = await sb.from("activities").insert({
      tenant_id: p.tenantId, account_id: p.accountId, contact_id: p.contactId ?? null, opportunity_id: p.opportunityId ?? null,
      owner_user_id: p.loggedBy, activity_type: "email",
      title: `メール送信: ${p.subject.trim() || "(件名なし)"}`.slice(0, 80),
      body: p.body.trim() || null, activity_at: now,
    }).select("id").single();
    activityId = (act?.id as string) ?? null;
  }

  const { data: msg, error: msgErr } = await sb.from("email_messages").insert({
    tenant_id: p.tenantId, direction: "out",
    subject: p.subject.trim() || null, snippet: emailSnippet(p.body),
    to_addrs: [p.to], from_addr: p.from.email,
    contact_id: p.contactId ?? null, account_id: p.accountId ?? null, opportunity_id: p.opportunityId ?? null,
    template_id: p.templateId ?? null, activity_id: activityId,
    source: "compose", sent_via: p.authMethod === "google_oauth" ? "gmail_api" : "smtp", status: "queued",
    track_token: openToken,
    sequence_enrollment_id: p.sequenceEnrollmentId ?? null, sequence_step: p.sequenceStep ?? null,
    sent_at: now, logged_by: p.loggedBy,
  }).select("id").single();
  if (msgErr || !msg) return { ok: false, error: "記録に失敗しました: " + (msgErr?.message ?? "") };
  const messageRowId = msg.id as string;

  if (linkTokens.length) {
    await sb.from("email_links").insert(linkTokens.map((l) => ({ tenant_id: p.tenantId, email_message_id: messageRowId, token: l.token, url: l.url })));
  }

  const html = buildTrackedHtml({ bodyText: p.body, baseUrl: p.baseUrl, openToken, linkTokens });
  const fromHeader = p.from.name ? `${p.from.name} <${p.from.email}>` : p.from.email;
  const bcc = p.bccSelf ? p.from.email : null;

  let sent: { ok: boolean; error?: string };
  if (p.authMethod === "google_oauth") {
    if (!p.oauthAccessToken) sent = { ok: false, error: "Googleアクセストークンがありません" };
    else {
      const mime = buildMime({ from: fromHeader, to: p.to, bcc, subject: p.subject, text: p.body, html, messageId });
      const r = await sendGmail(p.oauthAccessToken, mime);
      sent = r.ok ? { ok: true } : { ok: false, error: r.error };
    }
  } else {
    if (!p.smtp) sent = { ok: false, error: "SMTP設定がありません" };
    else sent = await sendMail(p.smtp, { to: p.to, subject: p.subject, text: p.body, html, bcc, messageId });
  }

  if (!sent.ok) {
    await sb.from("email_messages").update({ status: "failed", error_text: (sent.error ?? "").slice(0, 500) }).eq("id", messageRowId);
    return { ok: false, error: sent.error ?? "送信失敗", id: messageRowId };
  }
  await sb.from("email_messages").update({ status: "sent", smtp_message_id: normalizeMessageId(messageId) }).eq("id", messageRowId);

  if (p.opportunityId) await sb.from("opportunities").update({ last_activity_at: now }).eq("id", p.opportunityId);
  if (p.accountId) await sb.from("accounts").update({ last_activity_date: now.slice(0, 10) }).eq("id", p.accountId);
  return { ok: true, id: messageRowId };
}
