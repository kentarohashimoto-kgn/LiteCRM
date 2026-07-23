import crypto from "node:crypto";

/**
 * Cloud Pub/Sub Push の OIDC トークン検証（P3）。
 * Push 購読は Google 署名の OIDC JWT を Authorization: Bearer で送る。
 * 検証: 署名（Google OIDC x509証明書 / RS256）・iss(accounts.google.com)・
 *       aud(GOOGLE_CHAT_PUBSUB_AUDIENCE)・exp。
 * GOOGLE_CHAT_PUBSUB_AUDIENCE 未設定なら fail-closed。
 */

const OIDC_CERT_URL = "https://www.googleapis.com/oauth2/v1/certs";
const VALID_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAt > now) return certCache.certs;
  const res = await fetch(OIDC_CERT_URL);
  if (!res.ok) throw new Error(`oidc cert fetch failed: ${res.status}`);
  const certs = (await res.json()) as Record<string, string>;
  certCache = { certs, expiresAt: now + 60 * 60 * 1000 };
  return certs;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function b64urlToJson(s: string): any {
  return JSON.parse(b64urlToBuffer(s).toString("utf8"));
}

export interface PubsubVerifyResult {
  ok: boolean;
  reason?: string;
  claims?: Record<string, unknown>;
}

export async function verifyPubsubPush(authHeader: string | null): Promise<PubsubVerifyResult> {
  const audience = process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE;
  if (!audience) return { ok: false, reason: "GOOGLE_CHAT_PUBSUB_AUDIENCE not configured" };
  if (!authHeader || !authHeader.startsWith("Bearer ")) return { ok: false, reason: "missing bearer" };

  const parts = authHeader.slice(7).trim().split(".");
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

  if (!VALID_ISSUERS.has(String(claims.iss))) return { ok: false, reason: "bad issuer" };
  if (String(claims.aud) !== String(audience)) return { ok: false, reason: "bad audience" };
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
    if (!verifier.verify(crypto.createPublicKey(cert), b64urlToBuffer(sig))) {
      return { ok: false, reason: "bad signature" };
    }
  } catch (e) {
    return { ok: false, reason: `verify error: ${(e as Error).message}` };
  }

  return { ok: true, claims };
}
