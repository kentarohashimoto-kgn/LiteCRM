/**
 * freee OAuth クライアント（Layer①）。
 *
 * 秘匿トークンは freee_connections に保存し、**service role でのみ**読み書きする。
 * 期限切れが近ければ refresh_token で自動更新する。
 * 自動連携（Server Action/cron）と MCP は、いずれも本クライアント経由で freee を叩く。
 *
 * 必要な環境変数:
 *   FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REDIRECT_URI
 */
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { FREEE_API_BASE, FREEE_OAUTH_BASE } from "./types";

/** freee 未接続（OAuth未実施）を表すエラー。UI側で「接続してください」と案内する。 */
export class FreeeNotConnectedError extends Error {
  constructor(message = "freee が未接続です。設定 → freee連携 から接続してください。") {
    super(message);
    this.name = "FreeeNotConnectedError";
  }
}

/** freee APIエラー（レスポンスが 2xx でない）。 */
export class FreeeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FreeeApiError";
    this.status = status;
  }
}

interface ConnRow {
  id: string;
  tenant_id: string;
  company_id: number | null;
  company_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

export function freeeEnv() {
  const clientId = process.env.FREEE_CLIENT_ID;
  const clientSecret = process.env.FREEE_CLIENT_SECRET;
  const redirectUri = process.env.FREEE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REDIRECT_URI が未設定です。");
  }
  return { clientId, clientSecret, redirectUri };
}

/** OAuth認可URL（ユーザーをfreeeへ飛ばす）。 */
export function freeeAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = freeeEnv();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `${FREEE_OAUTH_BASE}/authorize?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${FREEE_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FreeeApiError(res.status, `トークン取得に失敗しました: ${text || res.statusText}`);
  }
  return (await res.json()) as TokenResponse;
}

/** 認可コードをトークンに交換（OAuthコールバックで使用）。 */
export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = freeeEnv();
  return requestToken({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
}

/**
 * テナントの接続を取り出し、必要なら期限前リフレッシュしてアクセストークンを返す。
 * 未接続なら FreeeNotConnectedError。
 */
async function ensureAccessToken(tenantId: string): Promise<{ token: string; conn: ConnRow }> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("freee_connections")
    .select("id, tenant_id, company_id, company_name, access_token, refresh_token, token_expires_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const conn = data as ConnRow | null;
  if (!conn || !conn.access_token || !conn.refresh_token) throw new FreeeNotConnectedError();

  // 期限の5分前を過ぎていればリフレッシュ
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (expMs && expMs - Date.now() > 5 * 60 * 1000) {
    return { token: conn.access_token, conn };
  }

  const { clientId, clientSecret } = freeeEnv();
  const tok = await requestToken({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: conn.refresh_token,
  });
  const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  await admin
    .from("freee_connections")
    .update({ access_token: tok.access_token, refresh_token: tok.refresh_token, token_expires_at: expiresAt })
    .eq("id", conn.id);
  return { token: tok.access_token, conn: { ...conn, access_token: tok.access_token, token_expires_at: expiresAt } };
}

/** freee API を叩く軽量クライアント（テナント単位）。 */
export class FreeeClient {
  constructor(
    private token: string,
    public conn: ConnRow,
  ) {}

  get companyId(): number {
    if (!this.conn.company_id) throw new Error("freee 事業所ID(company_id)が未設定です。");
    return this.conn.company_id;
  }

  async api<T = unknown>(path: string, init?: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> }): Promise<T> {
    const url = new URL(`${FREEE_API_BASE}${path}`);
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-Api-Version": "2020-06-15",
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new FreeeApiError(res.status, `freee API ${init?.method ?? "GET"} ${path} 失敗 (${res.status}): ${text || res.statusText}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

/** テナントの freee クライアントを取得（トークン自動更新つき）。未接続は FreeeNotConnectedError。 */
export async function getFreeeClient(tenantId: string): Promise<FreeeClient> {
  const { token, conn } = await ensureAccessToken(tenantId);
  return new FreeeClient(token, conn);
}
