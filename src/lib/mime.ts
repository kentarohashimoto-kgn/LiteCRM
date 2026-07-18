/**
 * WO-25 RFC822 メール(MIME)組み立て(F-101) — 純粋ロジック。
 * Gmail API(users.messages.send)へ渡す raw メールを組み立てる。
 * 日本語件名はRFC2047、本文はUTF-8 base64。tests/mime.test.ts で回帰固定。
 */

/** base64 を 76 文字ごとに改行(MIME準拠)。 */
function base64Wrap(input: string): string {
  const b64 = Buffer.from(input, "utf8").toString("base64");
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/** 件名などを RFC2047 (=?UTF-8?B?...?=) でエンコード(ASCIIのみならそのまま)。 */
export function encodeHeaderWord(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

export interface MimeInput {
  from: string;        // "名前 <a@b>" もしくは "a@b"
  to: string;
  bcc?: string | null;
  subject: string;
  text: string;
  html: string;
  messageId: string;   // "<...>" 形式
}

/**
 * multipart/alternative(text + html)の raw メールを組み立てて返す。
 * From の表示名部分は RFC2047 エンコードする。
 */
export function buildMime(p: MimeInput): string {
  const boundary = "b_" + Buffer.from(p.messageId).toString("hex").slice(0, 24);
  // From の表示名をエンコード( "名前 <addr>" 形式のみ対象 )
  let from = p.from;
  const m = p.from.match(/^(.*)<([^>]+)>\s*$/);
  if (m && m[1].trim()) from = `${encodeHeaderWord(m[1].trim())} <${m[2].trim()}>`;

  const headers = [
    `From: ${from}`,
    `To: ${p.to}`,
    ...(p.bcc ? [`Bcc: ${p.bcc}`] : []),
    `Subject: ${encodeHeaderWord(p.subject)}`,
    `Message-ID: ${p.messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join("\r\n");

  const body = [
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Wrap(p.text || ""),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Wrap(p.html || ""),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return headers + "\r\n" + body;
}

/** Gmail API 用の base64url(パディング無し)。 */
export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
