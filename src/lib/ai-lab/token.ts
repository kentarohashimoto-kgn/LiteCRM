/**
 * AI Lab の受講者セッショントークン(署名付き)。
 *
 * JWT ライブラリを足さずに、Web Crypto の HMAC-SHA256 で
 * 「payload.signature」だけの最小形式にしている。
 * 秘密鍵は引数で受け取る(テスト可能にするため)。呼び出し側は session.ts。
 */

export interface LabSessionPayload {
  /** ai_lab_users.id */
  uid: string;
  /** ai_lab_companies.id — URLのスラッグが指す会社と一致しなければ無効にする。 */
  cid: string;
  /** 有効期限(epoch秒) */
  exp: number;
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}
function b64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(new Uint8Array(sig)).toString("base64url");
}

export async function signLabToken(payload: LabSessionPayload, secret: string): Promise<string> {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${await hmac(body, secret)}`;
}

/**
 * 署名と有効期限を検証する。不正・期限切れは null。
 * 壊れた入力(空文字・base64不正など)でも例外は投げない。
 */
export async function verifyLabToken(
  token: string | null | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<LabSessionPayload | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = await hmac(body, secret);
    // 署名は同一長・固定文字集合なので、長さ比較 + 定数時間比較で十分。
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return null;

    const parsed = JSON.parse(b64urlDecode(body)) as Partial<LabSessionPayload>;
    if (typeof parsed?.uid !== "string" || typeof parsed?.cid !== "string" || typeof parsed?.exp !== "number") {
      return null;
    }
    if (parsed.exp <= nowSec) return null;
    return { uid: parsed.uid, cid: parsed.cid, exp: parsed.exp };
  } catch {
    return null;
  }
}
