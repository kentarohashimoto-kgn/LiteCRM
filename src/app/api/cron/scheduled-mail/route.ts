import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { deliverTrackedEmail, type DeliverParams } from "@/lib/mail-deliver";
import { refreshAccessToken } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

/**
 * 予約送信(0179)。指定時刻を過ぎた scheduled_emails を、予約者本人のアカウントで送信する。
 * 実配信・計測は通常送信と同じ deliverTrackedEmail に委譲（開封/クリック・配信停止フッター・履歴）。
 * 認可: Bearer CRON_SECRET。停止: batch_job_settings(job_kind='scheduled_mail')。
 * 資格情報は予約時に保持せず、送信時に user_mail_accounts から復号する。
 */

const MAX_PER_RUN = 100;
/** 送信者1人あたりの日次上限(通常送信と同じガード)。 */
const DAILY_CAP_PER_SENDER = 300;

function jstDayStartUtcIso(now: number): string {
  return new Date(Math.floor((now + 9 * 3600 * 1000) / 86400000) * 86400000 - 9 * 3600 * 1000).toISOString();
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!mailCredSecretConfigured()) return NextResponse.json({ ok: false, error: "MAIL_CRED_SECRET未設定" }, { status: 503 });

  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  const nowMs = Date.now();

  const { data: jobRows } = await admin.from("batch_job_settings").select("tenant_id, enabled").eq("job_kind", "scheduled_mail");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) return NextResponse.json({ ok: true, skipped: "job disabled", sent: 0 });

  // 期日到来の予約(古い順)
  const { data: dueRows } = await admin
    .from("scheduled_emails")
    .select("id, tenant_id, sender_user_id, to_addr, subject, body, contact_id, account_id, opportunity_id, lead_id, template_id, mail_batch_id, unsubscribe_footer, unsubscribe_header, create_activity, attempts")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date(nowMs).toISOString())
    .order("scheduled_at")
    .limit(MAX_PER_RUN);
  const due = (dueRows ?? []).filter((r) => enabledTenants.has(r.tenant_id as string));
  if (due.length === 0) return NextResponse.json({ ok: true, sent: 0, note: "対象なし" });

  // 送信者アカウントをまとめて取得(1人分の復号・トークン更新は1回だけ)
  const userIds = [...new Set(due.map((r) => r.sender_user_id as string))];
  const { data: accRows } = await admin
    .from("user_mail_accounts")
    .select("user_id, auth_method, smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_enc, oauth_refresh_token_enc, oauth_email, from_email, from_name, bcc_self, status")
    .in("user_id", userIds);
  const accMap = new Map((accRows ?? []).map((a) => [a.user_id as string, a]));

  // 本日(JST)の送信数を送信者ごとに集計(日次上限の判定用)
  const dayStart = jstDayStartUtcIso(nowMs);
  const sentToday = new Map<string, number>();
  for (const uid of userIds) {
    const { count } = await admin
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .eq("logged_by", uid).eq("direction", "out").in("status", ["sent", "queued"]).gte("sent_at", dayStart);
    sentToday.set(uid, count ?? 0);
  }

  // 認証情報の解決結果をキャッシュ(OAuthのトークン更新を人ごとに1回に抑える)
  const authCache = new Map<string, Pick<DeliverParams, "authMethod" | "smtp" | "oauthAccessToken" | "from"> | { error: string }>();
  async function resolveAuth(uid: string) {
    if (authCache.has(uid)) return authCache.get(uid)!;
    const acc = accMap.get(uid);
    if (!acc || acc.status !== "active") {
      const e = { error: "送信メールアカウントが未接続です" };
      authCache.set(uid, e);
      return e;
    }
    let resolved: Pick<DeliverParams, "authMethod" | "smtp" | "oauthAccessToken" | "from"> | { error: string };
    if (acc.auth_method === "google_oauth") {
      try {
        const tok = await refreshAccessToken(decryptSecret(acc.oauth_refresh_token_enc as string));
        resolved = tok.ok
          ? { authMethod: "google_oauth", oauthAccessToken: tok.accessToken, from: { email: (acc.oauth_email as string) || (acc.from_email as string), name: acc.from_name as string | null } }
          : { error: `Googleトークンの更新に失敗: ${tok.error}` };
      } catch { resolved = { error: "Google認証情報の復号に失敗しました" }; }
    } else {
      try {
        const password = decryptSecret(acc.smtp_password_enc as string);
        resolved = {
          authMethod: "smtp",
          from: { email: acc.from_email as string, name: acc.from_name as string | null },
          smtp: { host: acc.smtp_host as string, port: acc.smtp_port as number, secure: acc.smtp_secure as boolean, username: acc.smtp_username as string, password, fromEmail: acc.from_email as string, fromName: acc.from_name as string | null },
        };
      } catch { resolved = { error: "送信資格情報の復号に失敗しました" }; }
    }
    authCache.set(uid, resolved);
    return resolved;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  let sent = 0, failed = 0, skipped = 0, deferred = 0;

  for (const r of due) {
    const uid = r.sender_user_id as string;
    const tenantId = r.tenant_id as string;

    // 日次上限: 超過分は翌日以降へ持ち越す(予約は残す)
    if ((sentToday.get(uid) ?? 0) >= DAILY_CAP_PER_SENDER) { deferred++; continue; }

    // 配信停止の再確認(予約後に停止された可能性がある)
    const { data: sup } = await admin
      .from("mail_suppressions").select("id")
      .eq("tenant_id", tenantId).eq("email", String(r.to_addr).trim().toLowerCase()).maybeSingle();
    if (sup) {
      await admin.from("scheduled_emails").update({ status: "canceled", error_text: "配信停止済みのため送信しませんでした" }).eq("id", r.id);
      skipped++;
      continue;
    }

    const auth = await resolveAuth(uid);
    if ("error" in auth) {
      await admin.from("scheduled_emails").update({ status: "failed", error_text: auth.error, attempts: (r.attempts as number) + 1 }).eq("id", r.id);
      failed++;
      continue;
    }

    const res = await deliverTrackedEmail(admin, {
      tenantId, loggedBy: uid, ...auth,
      bccSelf: false,
      to: r.to_addr as string,
      subject: (r.subject as string) ?? "",
      body: (r.body as string) ?? "",
      contactId: r.contact_id as string | null,
      accountId: r.account_id as string | null,
      opportunityId: r.opportunity_id as string | null,
      leadId: r.lead_id as string | null,
      mailBatchId: r.mail_batch_id as string | null,
      templateId: r.template_id as string | null,
      createActivity: !!r.create_activity,
      unsubscribeFooter: !!r.unsubscribe_footer,
      // null は「フッターに追従」(既存行の従来挙動)。一括の header_only 予約はここで true
      unsubscribeHeader: r.unsubscribe_header === null || r.unsubscribe_header === undefined ? undefined : !!r.unsubscribe_header,
      baseUrl,
    });

    if (res.ok) {
      await admin.from("scheduled_emails").update({
        status: "sent", sent_at: new Date().toISOString(), email_message_id: res.id, error_text: null,
        attempts: (r.attempts as number) + 1,
      }).eq("id", r.id);
      sentToday.set(uid, (sentToday.get(uid) ?? 0) + 1);
      sent++;
      // 一括送信セグメントの件数を加算(セグメント分析の母数に反映)
      if (r.mail_batch_id) {
        const { data: b } = await admin.from("lead_mail_batches").select("sent_count").eq("id", r.mail_batch_id).maybeSingle();
        if (b) await admin.from("lead_mail_batches").update({ sent_count: (b.sent_count as number) + 1 }).eq("id", r.mail_batch_id);
      }
    } else {
      await admin.from("scheduled_emails").update({
        status: "failed", error_text: res.error.slice(0, 500), attempts: (r.attempts as number) + 1,
      }).eq("id", r.id);
      failed++;
    }
  }

  // 運用ログ
  try {
    const repTenant = due[0]?.tenant_id as string | undefined;
    if (repTenant) {
      await admin.from("batch_runs").insert({
        tenant_id: repTenant, job_kind: "scheduled_mail",
        run_date: new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10),
        started_at: startedAt, ended_at: new Date().toISOString(),
        status: failed > 0 ? "partial" : "success",
        targets_total: due.length, items_generated: sent, items_failed: failed,
        deferred_count: deferred,
        detail: { sent, failed, skipped, deferred },
      });
    }
  } catch { /* ログ失敗は無視 */ }

  return NextResponse.json({ ok: true, targets: due.length, sent, failed, skipped, deferred });
}
