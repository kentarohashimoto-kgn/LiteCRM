/**
 * WO-25 Gmail API(F-101a 経路①) — サーバー専用。REST を fetch で。
 * ・listInboundGmail: INBOX の新着メタデータ+抜粋を取得(受信同期)
 * ・sendGmail: raw MIME を送信(送信・本人アカウント)
 */

import "server-only";
import type { InboundMessage } from "@/lib/mail-imap";
import { toBase64Url } from "@/lib/mime";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function headerVal(headers: { name: string; value: string }[], name: string): string | null {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

export type GmailListResult =
  | { ok: true; messages: InboundMessage[] }
  | { ok: false; error: string };

/**
 * INBOX の afterUnix 以降の新着(自分の送信を除く)を最大 max 件、メタデータ+抜粋で取得。
 * 本文全文は取得しない(抜粋+リンク方針)。
 */
export async function listInboundGmail(accessToken: string, afterUnix: number, max = 30): Promise<GmailListResult> {
  const q = `in:inbox -from:me after:${Math.max(0, Math.floor(afterUnix))}`;
  const listRes = await fetch(`${BASE}/messages?maxResults=${max}&q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) return { ok: false, error: `messages.list ${listRes.status}` };
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: InboundMessage[] = [];

  for (const id of ids) {
    const mres = await fetch(
      `${BASE}/messages/${id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!mres.ok) continue;
    const msg = (await mres.json()) as { snippet?: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } };
    const headers = msg.payload?.headers ?? [];
    const refsRaw = headerVal(headers, "References");
    out.push({
      uid: 0,
      messageId: headerVal(headers, "Message-ID"),
      inReplyTo: headerVal(headers, "In-Reply-To"),
      references: refsRaw ? refsRaw.split(/\s+/).filter(Boolean) : [],
      from: headerVal(headers, "From"),
      subject: headerVal(headers, "Subject"),
      date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
      snippet: (msg.snippet ?? "").slice(0, 200),
    });
  }
  return { ok: true, messages: out };
}

export type GmailSendResult = { ok: true; id: string } | { ok: false; error: string };

/** raw RFC822 メールを Gmail から送信。 */
export async function sendGmail(accessToken: string, rawMime: string): Promise<GmailSendResult> {
  const res = await fetch(`${BASE}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: toBase64Url(rawMime) }),
  });
  if (!res.ok) {
    let detail = String(res.status);
    try { const j = await res.json(); detail = (j as { error?: { message?: string } })?.error?.message ?? detail; } catch { /* noop */ }
    return { ok: false, error: `gmail send: ${detail}` };
  }
  const j = (await res.json()) as { id?: string };
  return { ok: true, id: j.id ?? "" };
}
