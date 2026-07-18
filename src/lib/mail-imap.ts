/**
 * WO-24 IMAP受信取得(F-101a)。imapflow で INBOX の新着(前回UIDより先)を取得する。
 * サーバー専用。cron からのみ呼ぶ。本文全文は保持せず抜粋のみ返す(容量/プライバシー)。
 */

import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { emailSnippet } from "@/lib/email";

export interface ImapAccount {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface InboundMessage {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string | null;      // 生の From ヘッダ
  subject: string | null;
  date: string | null;      // ISO
  snippet: string;
}

export type FetchResult =
  | { ok: true; messages: InboundMessage[]; highestUid: number }
  | { ok: false; error: string };

/**
 * INBOX から uid > sinceUid の新着を最大 max 件取得(古い順)。
 * sinceUid=0 の初回は「直近 max 件」だけに絞り、過去全体は取り込まない。
 */
export async function fetchNewInbound(acc: ImapAccount, sinceUid: number, max = 30): Promise<FetchResult> {
  const client = new ImapFlow({
    host: acc.host,
    port: acc.port,
    secure: acc.secure,
    auth: { user: acc.username, pass: acc.password },
    logger: false,
    socketTimeout: 30000,
    greetingTimeout: 15000,
  });

  try {
    await client.connect();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const messages: InboundMessage[] = [];
  let highestUid = sinceUid;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mbox = client.mailbox;
      const uidNext = (mbox && typeof mbox === "object" && "uidNext" in mbox ? (mbox.uidNext as number) : 0) || 0;
      // 取得範囲: 初回(sinceUid=0)は直近max件、以降は sinceUid+1 以降
      let range: string;
      if (sinceUid > 0) {
        range = `${sinceUid + 1}:*`;
      } else if (uidNext > 1) {
        range = `${Math.max(1, uidNext - max)}:*`;
      } else {
        range = "1:*";
      }

      for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true }, { uid: true })) {
        const uid = msg.uid as number;
        if (uid <= sinceUid) continue;
        if (uid > highestUid) highestUid = uid;

        let messageId: string | null = null;
        let inReplyTo: string | null = null;
        let references: string[] = [];
        let from: string | null = null;
        let subject: string | null = null;
        let date: string | null = null;
        let snippet = "";

        try {
          const parsed = await simpleParser(msg.source as Buffer);
          messageId = parsed.messageId ?? null;
          inReplyTo = parsed.inReplyTo ?? null;
          references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
          from = parsed.from?.text ?? null;
          subject = parsed.subject ?? null;
          date = parsed.date ? parsed.date.toISOString() : null;
          snippet = emailSnippet(parsed.text ?? "", 200);
        } catch {
          // パース失敗時は envelope から最低限
          const env = msg.envelope;
          messageId = (env?.messageId as string) ?? null;
          inReplyTo = (env?.inReplyTo as string) ?? null;
          subject = (env?.subject as string) ?? null;
          from = env?.from?.[0] ? `${env.from[0].name ?? ""} <${env.from[0].address ?? ""}>` : null;
          date = env?.date ? new Date(env.date).toISOString() : null;
        }

        messages.push({ uid, messageId, inReplyTo, references, from, subject, date, snippet });
        if (messages.length >= max) break;
      }
    } finally {
      lock.release();
    }
    await client.logout();
    // 古い順に並べる(UID昇順)
    messages.sort((a, b) => a.uid - b.uid);
    return { ok: true, messages, highestUid };
  } catch (e) {
    try { await client.logout(); } catch { /* noop */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
