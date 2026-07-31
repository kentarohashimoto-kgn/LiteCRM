"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { csvCell } from "@/lib/lead-export";
import { logAudit, clientIp } from "@/lib/audit-events";
import {
  MAIL_EXPORT_FIELD_MAP, MAIL_EXPORT_DEFAULT_COLUMNS, mailExportValue,
  jstRangeToUtc, type MailHistoryRow,
} from "@/lib/mail-export";
import { resolveMailRecipients } from "@/lib/data/mail-recipients";

/**
 * メール送信履歴のCSV一括ダウンロード。
 * 件数が増えるため期間指定を前提とし、1000件ずつページングして全件を取り出す。
 * 宛先の会社名・担当者名はメールに持たないので、リード→取引先担当者→顧客の順に解決する。
 */

export interface MailHistoryFilters {
  /** JSTの日付(YYYY-MM-DD)。to はその日を含む */
  from?: string;
  to?: string;
  status?: string;
  /** 送信者(profiles.id) */
  sender?: string;
  /** "opened" = 開封あり / "clicked" = クリックあり / "failed_only" = 失敗のみ */
  reaction?: string;
  templateId?: string;
  batchId?: string;
}

export interface MailExportResult { csv: string; count: number; error?: string }

/** 上限。1回のダウンロードで扱う最大件数(メモリ保護)。超えたら期間を狭めてもらう。 */
const MAX_ROWS = 50_000;
const PAGE = 1000;

export async function exportEmailHistoryCsvAction(
  filters: MailHistoryFilters,
  columns?: string[],
): Promise<MailExportResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const cols = (columns?.length ? columns : MAIL_EXPORT_DEFAULT_COLUMNS).filter((c) => MAIL_EXPORT_FIELD_MAP[c]);
  if (!cols.length) return { csv: "", count: 0, error: "列が選択されていません" };

  const range = jstRangeToUtc(filters.from, filters.to);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let qy = sb
      .from("email_messages")
      .select("id, subject, to_addrs, status, sent_via, sent_at, open_count, last_opened_at, click_count, error_text, lead_id, contact_id, account_id, template_id, mail_batch_id, logged_by, smtp_message_id, last_clicked_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("direction", "out");
    if (range.gte) qy = qy.gte("sent_at", range.gte);
    if (range.lt) qy = qy.lt("sent_at", range.lt);
    if (filters.status) qy = qy.eq("status", filters.status);
    if (filters.sender) qy = qy.eq("logged_by", filters.sender);
    if (filters.templateId) qy = qy.eq("template_id", filters.templateId);
    if (filters.batchId) qy = qy.eq("mail_batch_id", filters.batchId);
    if (filters.reaction === "opened") qy = qy.gt("open_count", 0);
    if (filters.reaction === "clicked") qy = qy.gt("click_count", 0);
    if (filters.reaction === "failed_only") qy = qy.eq("status", "failed");

    const { data, error } = await qy.order("sent_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + PAGE - 1);
    if (error) return { csv: "", count: 0, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE || rows.length >= MAX_ROWS) break;
  }
  if (rows.length === 0) return { csv: "", count: 0, error: "該当する送信履歴がありません（期間・条件をご確認ください）" };

  // --- 参照名の解決(いずれも id の集合に対する一括取得) ---
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
  const tplIds = uniq(rows.map((r) => r.template_id));
  const batchIds = uniq(rows.map((r) => r.mail_batch_id));
  const userIds = uniq(rows.map((r) => r.logged_by));
  const emails = uniq(rows.map((r) => String((r.to_addrs ?? [])[0] ?? "").toLowerCase()));
  const msgIds = uniq(rows.map((r) => r.smtp_message_id));

  const chunked = async <T,>(ids: string[], fn: (slice: string[]) => Promise<T[]>): Promise<T[]> => {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 500) out.push(...(await fn(ids.slice(i, i + 500))));
    return out;
  };

  // 宛先(会社名・担当者名)はリード→取引先担当者→顧客の順に解決(送信履歴画面と共通)
  const recipients = await resolveMailRecipients(rows);

  const tplMap = new Map<string, string>();
  await chunked(tplIds, async (s) => {
    const { data } = await sb.from("email_templates").select("id, name").in("id", s);
    for (const t of data ?? []) tplMap.set(t.id as string, (t.name as string) ?? "");
    return data ?? [];
  });

  const batchMap = new Map<string, string>();
  await chunked(batchIds, async (s) => {
    const { data } = await sb.from("lead_mail_batches").select("id, title").in("id", s);
    for (const b of data ?? []) batchMap.set(b.id as string, (b.title as string) ?? "");
    return data ?? [];
  });

  const userMap = new Map<string, string>();
  await chunked(userIds, async (s) => {
    const { data } = await sb.from("profiles").select("id, display_name, email").in("id", s);
    for (const u of data ?? []) userMap.set(u.id as string, ((u.display_name as string) || (u.email as string)) ?? "");
    return data ?? [];
  });

  // 返信の有無: 受信側(direction=in)の in_reply_to が、この送信の Message-ID を指しているか
  const repliedIds = new Set<string>();
  await chunked(msgIds, async (s) => {
    const { data } = await sb.from("email_messages").select("in_reply_to").eq("direction", "in").in("in_reply_to", s);
    for (const m of data ?? []) if (m.in_reply_to) repliedIds.add(String(m.in_reply_to));
    return data ?? [];
  });

  const suppressed = new Set<string>();
  await chunked(emails, async (s) => {
    const { data } = await sb.from("mail_suppressions").select("email").in("email", s);
    for (const m of data ?? []) suppressed.add(String(m.email).toLowerCase());
    return data ?? [];
  });

  const out: MailHistoryRow[] = rows.map((r) => {
    const rec = recipients.get(r.id as string);
    const email = String((r.to_addrs ?? [])[0] ?? "");
    return {
      sentAt: r.sent_at ?? null,
      company: rec?.company ?? "",
      contact: rec?.contact ?? "",
      email,
      subject: r.subject ?? null,
      status: r.status ?? "",
      sentVia: r.sent_via ?? null,
      errorText: r.error_text ?? null,
      openCount: r.open_count ?? 0,
      lastOpenedAt: r.last_opened_at ?? null,
      clickCount: r.click_count ?? 0,
      lastClickedAt: r.last_clicked_at ?? null,
      replied: !!r.smtp_message_id && repliedIds.has(r.smtp_message_id as string),
      senderName: r.logged_by ? userMap.get(r.logged_by) ?? "" : "",
      templateName: r.template_id ? tplMap.get(r.template_id) ?? "" : "",
      segmentTitle: r.mail_batch_id ? batchMap.get(r.mail_batch_id) ?? "" : "",
      event: rec?.event ?? "",
      unsubscribed: suppressed.has(email.toLowerCase()),
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const header = cols.map((c) => csvCell(MAIL_EXPORT_FIELD_MAP[c].label)).join(",");
  const lines = out.map((r) => cols.map((c) => csvCell(mailExportValue(c, r))).join(","));

  // 監査ログ(送信先=個人情報の持ち出しのため記録)
  await logAudit({
    tenantId: ctx.tenantId, userId: ctx.userId, email: ctx.email,
    action: "email_history.export_csv", target: `${out.length}件`,
    meta: { count: out.length, columns: cols.length, filters }, ip: clientIp(),
  });

  return { csv: "﻿" + [header, ...lines].join("\r\n"), count: out.length };
}
