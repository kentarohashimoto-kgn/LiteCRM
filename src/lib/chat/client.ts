import crypto from "node:crypto";

/**
 * Google Chat API の低レベルクライアント（Bot = アプリ認証）。
 *
 * 認証は Service Account の JWT を Google のトークンエンドポイントで
 * アクセストークンに交換して行う（外部SDK不要・Nodeランタイム専用）。
 *
 * 必要な環境変数:
 *   GOOGLE_CHAT_SA_CREDENTIALS  Service Account の JSON（生 or Base64）。未設定なら無効。
 *
 * 未設定時は getChatCredentials() が null を返し、上位層(send.ts)が no-op になる。
 */

const CHAT_API_BASE = "https://chat.googleapis.com/v1";
const CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";

interface SaCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/** GOOGLE_CHAT_SA_CREDENTIALS を解釈。未設定/不正なら null。 */
export function getChatCredentials(): SaCredentials | null {
  const raw = process.env.GOOGLE_CHAT_SA_CREDENTIALS;
  if (!raw) return null;
  try {
    // 生JSON、またはBase64化されたJSONの両方を受け付ける。
    const text = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text) as Partial<SaCredentials>;
    if (!json.client_email || !json.private_key) return null;
    return {
      client_email: json.client_email,
      private_key: json.private_key.replace(/\\n/g, "\n"),
      token_uri: json.token_uri || "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

/** Chat連携が構成済みか。 */
export function isChatConfigured(): boolean {
  return getChatCredentials() !== null;
}

// アクセストークンのメモリキャッシュ（スコープ単位）。
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Service Account の JWT を発行 → アクセストークンに交換（キャッシュ付き）。 */
async function getAccessToken(scope: string = CHAT_BOT_SCOPE): Promise<string | null> {
  const creds = getChatCredentials();
  if (!creds) return null;

  const cached = tokenCache.get(scope);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) return cached.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: creds.client_email,
    scope,
    aud: creds.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = base64url(signer.sign(creds.private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(creds.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Chat token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(scope, { token: data.access_token, expiresAt: now + data.expires_in });
  return data.access_token;
}

/** Chat API を叩く薄いラッパ。認証未設定なら null を返す。 */
async function chatApiFetch<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  scope: string = CHAT_BOT_SCOPE,
): Promise<T | null> {
  const token = await getAccessToken(scope);
  if (!token) return null;
  const res = await fetch(`${CHAT_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Chat API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Chat メッセージ本体（テキスト or カード）。 */
export interface ChatMessagePayload {
  text?: string;
  cardsV2?: unknown[];
}

/** Space（DM含む）にメッセージを作成。 */
export async function createMessage(
  spaceName: string,
  payload: ChatMessagePayload,
): Promise<{ name: string } | null> {
  return chatApiFetch<{ name: string }>(
    "POST",
    `/${spaceName}/messages`,
    payload,
  );
}

/** アプリと指定ユーザーの DM Space を検索（存在すれば返す）。 */
export async function findDirectMessage(chatUserId: string): Promise<{ name: string } | null> {
  // chatUserId は "users/1234567890"。name クエリに渡す。
  const q = encodeURIComponent(chatUserId);
  return chatApiFetch<{ name: string }>("GET", `/spaces:findDirectMessage?name=${q}`);
}

/** アプリと指定ユーザーの DM Space を作成/取得（存在すれば既存を返す）。 */
export async function setupDirectMessage(chatUserId: string): Promise<{ name: string } | null> {
  return chatApiFetch<{ name: string }>("POST", `/spaces:setup`, {
    space: { spaceType: "DIRECT_MESSAGE" },
    memberships: [{ member: { name: chatUserId, type: "HUMAN" } }],
  });
}
