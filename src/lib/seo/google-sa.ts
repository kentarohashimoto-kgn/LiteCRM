import "server-only";
import crypto from "node:crypto";

/**
 * SEO計測用 Google API のサービスアカウント認証（サーバー専用）。
 *
 * Search Console / GA4 Data API はテナントの資産であり、担当者個人のOAuthに
 * 依存させると退職・再認証で計測が欠測する。そのためサービスアカウント(SA)で接続する。
 *
 * 資格情報は次の順で解決する:
 *   1. GOOGLE_SEO_SA_CREDENTIALS   … SEO専用SA（推奨）
 *   2. GOOGLE_CHAT_SA_CREDENTIALS  … 既にGoogle Chat連携で稼働中のSAを流用
 * どちらも未設定なら null を返し、上位層が安全に無効化される（503を返す等）。
 *
 * 実装は googleapis SDK を使わず JWT を自己署名して fetch で交換する
 * （既存の src/lib/chat/client.ts と同じ方式・新規依存ゼロ）。
 *
 * 必要な権限（GCPでSAを作った後、それぞれ3分の作業）:
 *   - Search Console → 設定 → ユーザーと権限 → SAのメールを「制限付き」で追加
 *   - GA4 → 管理 → プロパティのアクセス管理 → SAのメールを「閲覧者」で追加
 */

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

interface SaCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
  /** どの環境変数から解決したか（設定画面の表示・診断用）。 */
  source: "seo" | "chat";
}

/** SAのJSON(生 or Base64)を解釈する。不正なら null。 */
function parseCredentials(raw: string, source: SaCredentials["source"]): SaCredentials | null {
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text) as Partial<SaCredentials>;
    if (!json.client_email || !json.private_key) return null;
    return {
      client_email: json.client_email,
      private_key: json.private_key.replace(/\\n/g, "\n"),
      token_uri: json.token_uri || "https://oauth2.googleapis.com/token",
      source,
    };
  } catch {
    return null;
  }
}

/** SEO用SA資格情報。未設定・不正なら null。 */
export function getSeoCredentials(): SaCredentials | null {
  const own = process.env.GOOGLE_SEO_SA_CREDENTIALS;
  if (own) {
    const parsed = parseCredentials(own, "seo");
    if (parsed) return parsed;
  }
  // Google Chat連携で既に稼働しているSAを流用できる（同一GCPプロジェクト）。
  const chat = process.env.GOOGLE_CHAT_SA_CREDENTIALS;
  if (chat) return parseCredentials(chat, "chat");
  return null;
}

export function seoGoogleConfigured(): boolean {
  return getSeoCredentials() !== null;
}

/** 設定画面に出す接続情報（秘密鍵は絶対に含めない）。 */
export function getSeoCredentialInfo(): { configured: boolean; clientEmail: string | null; source: string | null } {
  const creds = getSeoCredentials();
  return {
    configured: !!creds,
    clientEmail: creds?.client_email ?? null,
    source: creds?.source ?? null,
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// アクセストークンのメモリキャッシュ（スコープ単位）。
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** SAのJWTをアクセストークンに交換する（1時間キャッシュ）。未設定なら null。 */
export async function getSeoAccessToken(scope: string): Promise<string | null> {
  const creds = getSeoCredentials();
  if (!creds) return null;

  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${creds.client_email}:${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - 60 > now) return cached.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: creds.client_email, scope, aud: creds.token_uri, iat: now, exp: now + 3600 };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const assertion = `${signingInput}.${base64url(signer.sign(creds.private_key))}`;

  const res = await fetch(creds.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) {
    throw new Error(`SEO用SAのトークン取得に失敗しました (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: now + data.expires_in });
  return data.access_token;
}

/** APIレスポンスの状態分類（接続診断の表示に使う）。 */
export type ApiStatus = "ok" | "forbidden" | "not_found" | "error";

export function classifyStatus(httpStatus: number): ApiStatus {
  if (httpStatus >= 200 && httpStatus < 300) return "ok";
  if (httpStatus === 401 || httpStatus === 403) return "forbidden";
  if (httpStatus === 404) return "not_found";
  return "error";
}
