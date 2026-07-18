import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { fetchNewInbound, type InboundMessage } from "@/lib/mail-imap";
import { listInboundGmail } from "@/lib/gmail-api";
import { refreshAccessToken } from "@/lib/google-oauth";
import { MAIL_PROVIDER_MAP } from "@/lib/email";
import {
  extractEmail,
  referencedIds,
  normalizeMessageId,
  classifyInbound,
  providerSearchLink,
} from "@/lib/inbound-match";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WO-24 メール受信同期(F-101a・IMAP)。inbound_enabled の各営業のINBOXを増分取得し、
 * 「該当メールだけ」(自分の送信への返信 / 既知の取引先からの受信)を抜粋+リンクで記録。
 * 返信を検知したら該当シーケンス投入を自動停止する。無関係メールは保存しない。
 * 認可: Bearer CRON_SECRET。停止: batch_job_settings(job_kind='email_inbound_sync')。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!mailCredSecretConfigured()) return NextResponse.json({ ok: false, error: "MAIL_CRED_SECRET未設定" }, { status: 503 });

  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  const runDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const { data: jobRows } = await admin.from("batch_job_settings").select("tenant_id, enabled").eq("job_kind", "email_inbound_sync");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) return NextResponse.json({ ok: true, skipped: "job disabled", saved: 0 });

  const { data: accts } = await admin
    .from("user_mail_accounts")
    .select("id, tenant_id, user_id, provider, auth_method, from_email, imap_host, imap_port, smtp_secure, smtp_username, smtp_password_enc, oauth_refresh_token_enc, imap_last_uid, inbound_last_run_at, status, inbound_enabled")
    .eq("inbound_enabled", true)
    .eq("status", "active");
  const accounts = (accts ?? []).filter((a) => enabledTenants.has(a.tenant_id as string));
  if (accounts.length === 0) return NextResponse.json({ ok: true, saved: 0, note: "受信有効なアカウントなし" });

  let savedTotal = 0, repliesStopped = 0, discarded = 0, accountErrors = 0;

  for (const a of accounts) {
    const tenantId = a.tenant_id as string;
    const userId = a.user_id as string;
    const provider = (a.provider as string) ?? "other";
    const isOAuth = a.auth_method === "google_oauth";

    // 受信取得: OAuth=Gmail API / それ以外=IMAP。どちらも {ok, messages} を返す。
    let res: { ok: true; messages: InboundMessage[]; highestUid?: number } | { ok: false; error: string };
    if (isOAuth) {
      let token = "";
      try { const t = await refreshAccessToken(decryptSecret(a.oauth_refresh_token_enc as string)); if (!t.ok) { await admin.from("user_mail_accounts").update({ inbound_last_error: `Googleトークン更新失敗: ${t.error.slice(0, 200)}`, inbound_last_run_at: new Date().toISOString() }).eq("id", a.id); accountErrors++; continue; } token = t.accessToken; }
      catch { await admin.from("user_mail_accounts").update({ inbound_last_error: "Google認証情報の復号に失敗", inbound_last_run_at: new Date().toISOString() }).eq("id", a.id); accountErrors++; continue; }
      const lastRun = a.inbound_last_run_at ? new Date(a.inbound_last_run_at as string).getTime() : Date.now() - 24 * 3600 * 1000;
      const afterUnix = Math.floor((lastRun - 120000) / 1000); // 2分バッファ(冪等でカバー)
      res = await listInboundGmail(token, afterUnix, 30);
    } else {
      const preset = MAIL_PROVIDER_MAP[provider];
      const host = (a.imap_host as string) || preset?.imapHost || "";
      if (!host) { accountErrors++; continue; }
      let password = "";
      try { password = decryptSecret(a.smtp_password_enc as string); }
      catch { await admin.from("user_mail_accounts").update({ inbound_last_error: "資格情報の復号に失敗", inbound_last_run_at: new Date().toISOString() }).eq("id", a.id); accountErrors++; continue; }
      res = await fetchNewInbound({ host, port: (a.imap_port as number) || 993, secure: true, username: a.smtp_username as string, password }, (a.imap_last_uid as number) ?? 0, 30);
    }

    if (!res.ok) {
      await admin.from("user_mail_accounts").update({ inbound_last_error: res.error.slice(0, 300), inbound_last_run_at: new Date().toISOString() }).eq("id", a.id);
      accountErrors++;
      continue;
    }
    if (res.messages.length === 0) {
      await admin.from("user_mail_accounts").update({ inbound_last_error: null, inbound_last_run_at: new Date().toISOString() }).eq("id", a.id);
      continue;
    }

    // 自分の送信 Message-Id → 送信行(関連付け用)
    const { data: sends } = await admin
      .from("email_messages")
      .select("id, smtp_message_id, opportunity_id, contact_id, account_id")
      .eq("tenant_id", tenantId)
      .eq("logged_by", userId)
      .eq("direction", "out")
      .not("smtp_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    const sendById = new Map<string, { opportunity_id: string | null; contact_id: string | null; account_id: string | null }>();
    const msgIdToId = new Map<string, string>();
    for (const s of sends ?? []) {
      const nid = normalizeMessageId(s.smtp_message_id as string);
      if (nid) { msgIdToId.set(nid, s.id as string); sendById.set(s.id as string, { opportunity_id: s.opportunity_id as string | null, contact_id: s.contact_id as string | null, account_id: s.account_id as string | null }); }
    }

    // 送信者アドレス → 既知の取引先
    const senderEmails = [...new Set(res.messages.map((m) => extractEmail(m.from)).filter(Boolean) as string[])];
    const contactByEmail = new Map<string, { id: string; account_id: string | null }>();
    if (senderEmails.length) {
      const { data: cs } = await admin.from("contacts").select("id, email, account_id").eq("tenant_id", tenantId).in("email", senderEmails);
      for (const c of cs ?? []) {
        const e = (c.email as string)?.toLowerCase();
        if (e) contactByEmail.set(e, { id: c.id as string, account_id: c.account_id as string | null });
      }
    }
    const knownEmails = new Set(contactByEmail.keys());

    for (const m of res.messages) {
      const senderEmail = extractEmail(m.from);
      const refs = referencedIds(m.inReplyTo, m.references);
      const rel = classifyInbound({ refIds: refs, senderEmail, ourSendIdByMessageId: msgIdToId, knownContactEmails: knownEmails });
      if (rel.kind === "discard") { discarded++; continue; }

      const normId = normalizeMessageId(m.messageId);
      // 冪等: 同一受信の二重取込を防ぐ
      if (normId) {
        const { data: dup } = await admin.from("email_messages").select("id").eq("tenant_id", tenantId).eq("direction", "in").eq("smtp_message_id", normId).limit(1);
        if (dup?.length) continue;
      }

      let oppId: string | null = null, contactId: string | null = null, accountId: string | null = null;
      if (rel.kind === "reply") {
        const s = sendById.get(rel.matchedSendId);
        oppId = s?.opportunity_id ?? null; contactId = s?.contact_id ?? null; accountId = s?.account_id ?? null;
      } else {
        const c = senderEmail ? contactByEmail.get(senderEmail) : null;
        contactId = c?.id ?? null; accountId = c?.account_id ?? null;
      }

      const sentAt = m.date ?? new Date().toISOString();
      // タイムライン活動
      let activityId: string | null = null;
      if (accountId) {
        const { data: act } = await admin.from("activities").insert({
          tenant_id: tenantId, account_id: accountId, contact_id: contactId, opportunity_id: oppId,
          owner_user_id: userId, activity_type: "email",
          title: `メール受信: ${(m.subject ?? "").trim() || "(件名なし)"}`.slice(0, 80),
          body: m.snippet || null, activity_at: sentAt,
        }).select("id").single();
        activityId = (act?.id as string) ?? null;
      }
      // 受信メッセージ(抜粋+リンク)
      await admin.from("email_messages").insert({
        tenant_id: tenantId, direction: "in",
        subject: (m.subject ?? "").trim() || null,
        snippet: m.snippet || null,
        from_addr: senderEmail,
        to_addrs: [a.from_email as string],
        contact_id: contactId, account_id: accountId, opportunity_id: oppId,
        activity_id: activityId,
        source: isOAuth ? "gmail_sync" : "imap_sync", status: "received",
        smtp_message_id: normId, in_reply_to: normalizeMessageId(m.inReplyTo),
        provider_link: providerSearchLink(provider, m.messageId),
        sent_at: sentAt, logged_by: userId,
      });
      savedTotal++;

      if (oppId) await admin.from("opportunities").update({ last_activity_at: sentAt }).eq("id", oppId);
      if (accountId) await admin.from("accounts").update({ last_activity_date: sentAt.slice(0, 10) }).eq("id", accountId);

      // 返信 → 該当シーケンス投入を自動停止
      if (rel.kind === "reply" && senderEmail) {
        const { data: stopped } = await admin
          .from("sequence_enrollments")
          .update({ status: "stopped", stopped_reason: "返信により停止" })
          .eq("tenant_id", tenantId).eq("status", "active").eq("to_addr", senderEmail)
          .select("id");
        repliesStopped += stopped?.length ?? 0;
      }
    }

    const posUpdate: Record<string, unknown> = { inbound_last_error: null, inbound_last_run_at: new Date().toISOString() };
    if (!isOAuth && res.highestUid !== undefined) posUpdate.imap_last_uid = Math.max(res.highestUid, (a.imap_last_uid as number) ?? 0);
    await admin.from("user_mail_accounts").update(posUpdate).eq("id", a.id);
  }

  try {
    const repTenant = accounts[0]?.tenant_id as string | undefined;
    if (repTenant) {
      await admin.from("batch_runs").insert({
        tenant_id: repTenant, job_kind: "email_inbound_sync", run_date: runDate,
        started_at: startedAt, ended_at: new Date().toISOString(),
        status: accountErrors ? "partial" : "success",
        targets_total: accounts.length, items_generated: savedTotal, items_failed: accountErrors,
        detail: { saved: savedTotal, repliesStopped, discarded, accountErrors },
      });
    }
  } catch { /* ログ失敗は無視 */ }

  return NextResponse.json({ ok: true, accounts: accounts.length, saved: savedTotal, repliesStopped, discarded, accountErrors });
}
