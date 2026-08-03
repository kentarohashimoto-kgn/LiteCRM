/**
 * 会社別URL(/lab/{slug})の一次ゲートである HTTP Basic 認証。
 *
 * middleware(Edge ランタイム)から呼ぶため、Node 固有API(Buffer/node:crypto)を使わず
 * Web 標準(atob / TextDecoder / crypto.subtle)だけで実装する。
 */

export interface BasicCredentials {
  user: string;
  pass: string;
}

/** `Authorization: Basic xxx` を解く。不正な形式は null(例外は投げない)。 */
export function parseBasicAuth(header: string | null | undefined): BasicCredentials | null {
  if (!header) return null;
  const m = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  let decoded: string;
  try {
    const bin = atob(m[1].trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    decoded = new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
  // パスワード側にコロンを含められるよう、最初のコロンだけで分割する。
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 文字列の定数時間比較(長さが違う時点で false)。 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** ID完全一致 かつ パスワードのSHA-256一致で true。 */
export async function verifyBasicCredentials(
  header: string | null | undefined,
  expectedUser: string,
  expectedHashHex: string,
): Promise<boolean> {
  const creds = parseBasicAuth(header);
  if (!creds) return false;
  if (!expectedUser || !expectedHashHex) return false;
  const userOk = safeEqual(creds.user, expectedUser);
  const passOk = safeEqual(await sha256Hex(creds.pass), expectedHashHex.toLowerCase());
  // 早期 return をせず両方を評価してから判定する(どちらが誤りか計測されないように)。
  return userOk && passOk;
}
