/**
 * WO-24 受信メールの照合・関連性判定(F-101a) — 純粋ロジック。
 * 「該当メールだけ保存」(ユーザー要望)を担う中核。DB非依存=tests/inbound-match.test.ts。
 */

/** Message-Id を正規化( <...> や前後空白を除去 )。 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().replace(/^<|>$/g, "").trim();
  return m || null;
}

/** In-Reply-To / References から参照Message-Idの集合を作る(正規化・重複除去)。 */
export function referencedIds(inReplyTo: string | null | undefined, references: string | string[] | null | undefined): string[] {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    for (const tok of (s ?? "").split(/\s+/)) {
      const n = normalizeMessageId(tok);
      if (n) out.add(n);
    }
  };
  add(inReplyTo);
  if (Array.isArray(references)) references.forEach(add);
  else add(references);
  return [...out];
}

/** "山田 <taro@example.com>" 等から小文字のメールアドレスだけ取り出す。 */
export function extractEmail(from: string | null | undefined): string | null {
  if (!from) return null;
  const m = from.match(/<([^>]+)>/);
  const raw = (m ? m[1] : from).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
}

export type Relevance =
  | { kind: "reply"; matchedSendId: string }  // 自分の送信への返信(matchedSendId=送信側 email_messages.id)
  | { kind: "inbound" }                        // 既知の取引先からの受信
  | { kind: "discard" };                        // 無関係=保存しない

/**
 * 受信1通の関連性を判定する。
 * - ourSendIdByMessageId: 自分の送信 Message-Id -> email_messages.id のマップ
 * - knownContactEmails: 既知の取引先メール(小文字)の集合
 */
export function classifyInbound(params: {
  refIds: string[];
  senderEmail: string | null;
  ourSendIdByMessageId: Map<string, string>;
  knownContactEmails: Set<string>;
}): Relevance {
  for (const rid of params.refIds) {
    const sendId = params.ourSendIdByMessageId.get(rid);
    if (sendId) return { kind: "reply", matchedSendId: sendId };
  }
  if (params.senderEmail && params.knownContactEmails.has(params.senderEmail)) {
    return { kind: "inbound" };
  }
  return { kind: "discard" };
}

/** Gmail/Zoho でそのメールを検索して開くためのリンク(抜粋+リンク方針の"リンク")。 */
export function providerSearchLink(provider: string, messageId: string | null): string | null {
  const id = normalizeMessageId(messageId);
  if (!id) return null;
  if (provider === "gws") return `https://mail.google.com/mail/#search/rfc822msgid:${encodeURIComponent(id)}`;
  if (provider === "zoho") return `https://mail.zoho.com/zm/#mail/folder/search/${encodeURIComponent(id)}`;
  return null;
}
