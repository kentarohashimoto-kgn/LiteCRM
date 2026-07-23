import crypto from "node:crypto";

/**
 * Google Chat からの受信リクエストの正当性検証。
 *
 * Chat App のインタラクションイベントは `Authorization: Bearer <JWT>` を伴い、
 * この JWT は Google が `chat@system.gserviceaccount.com` の鍵で署名している。
 * 検証内容:
 *   - 署名（Google の x509 公開証明書で RS256 検証）
 *   - iss == chat@system.gserviceaccount.com
 *   - aud == 自分の Google Cloud プロジェクト番号（GOOGLE_CHAT_PROJECT_NUMBER）
 *   - exp（期限切れでない）
 *
 * GOOGLE_CHAT_PROJECT_NUMBER 未設定なら fail-closed（検証不能として拒否）。
 */

const CERT_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com";
const CHAT_ISSUER = "chat@system.gserviceaccount.com";

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAt > now) return certCache.certs;
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`);
  const certs = (await res.json()) as Record<string, string>;
  certCache = { certs, expiresAt: now + 60 * 60 * 1000 }; // 1h キャッシュ
  return certs;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function b64urlToJson(s: string): any {
  return JSON.parse(b64urlToBuffer(s).toString("utf8"));
}

export interface ChatVerifyResult {
  ok: boolean;
  reason?: string;
  claims?: Record<string, unknown>;
}

/** Chat リクエストの Bearer JWT を検証。 */
export async function verifyChatRequest(authHeader: string | null): Promise<ChatVerifyResult> {
  const projectNumber = process.env.GOOGLE_CHAT_PROJECT_NUMBER;
  if (!projectNumber) return { ok: false, reason: "GOOGLE_CHAT_PROJECT_NUMBER not configured" };
  if (!authHeader || !authHeader.startsWith("Bearer ")) return { ok: false, reason: "missing bearer" };

  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [h, p, sig] = parts;

  let header: any;
  let claims: any;
  try {
    header = b64urlToJson(h);
    claims = b64urlToJson(p);
  } catch {
    return { ok: false, reason: "undecodable token" };
  }

  if (claims.iss !== CHAT_ISSUER) return { ok: false, reason: "bad issuer" };
  if (String(claims.aud) !== String(projectNumber)) return { ok: false, reason: "bad audience" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < nowSec) return { ok: false, reason: "expired" };

  let certs: Record<string, string>;
  try {
    certs = await getCerts();
  } catch (e) {
    return { ok: false, reason: `cert error: ${(e as Error).message}` };
  }
  const cert = header.kid ? certs[header.kid] : undefined;
  if (!cert) return { ok: false, reason: "unknown key id" };

  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    verifier.end();
    const pub = crypto.createPublicKey(cert);
    const valid = verifier.verify(pub, b64urlToBuffer(sig));
    if (!valid) return { ok: false, reason: "bad signature" };
  } catch (e) {
    return { ok: false, reason: `verify error: ${(e as Error).message}` };
  }

  return { ok: true, claims };
}
