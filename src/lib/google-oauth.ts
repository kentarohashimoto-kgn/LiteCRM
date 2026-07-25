/**
 * WO-25 Google OAuth(F-101a 経路①) — サーバー専用。
 * 内部(Internal)OAuthアプリで gmail.readonly + gmail.send を取得する。
 * googleapis SDK は使わず REST を fetch で叩く(依存を軽く)。
 * 必要な環境変数: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET。
 */

import "server-only";
import { createHmac } from "crypto";

/** CSRF対策の state 署名(MAIL_CRED_SECRET でHMAC)。 */
export function signOAuthState(userId: string): string {
  return createHmac("sha256", process.env.MAIL_CRED_SECRET ?? "").update(`oauth:${userId}`).digest("hex").slice(0, 32);
}
export function verifyOAuthState(userId: string, state: string | null): boolean {
  return !!state && signOAuthState(userId) === state;
}

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  // マインドマップの週次自動生成でカレンダー予定を読む(参照のみ)。
  // 既にGmailのみで接続済みのユーザーは再接続するまで403になり、その旨を画面で案内する。
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function googleOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** 認可URLを組み立てる。offline+consent で refresh_token を確実に得る。 */
export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResp { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }

/** 認可コードをトークンに交換。refresh_token と access_token を返す。 */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ ok: true; refreshToken: string; accessToken: string } | { ok: false; error: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const j = (await res.json()) as TokenResp;
  if (!res.ok || !j.access_token) return { ok: false, error: j.error_description || j.error || `token exchange failed (${res.status})` };
  if (!j.refresh_token) return { ok: false, error: "refresh_tokenが取得できませんでした（Googleアカウント側の権限を一度解除して再接続してください）" };
  return { ok: true, refreshToken: j.refresh_token, accessToken: j.access_token };
}

/** refresh_token から access_token を取得。 */
export async function refreshAccessToken(refreshToken: string): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  const j = (await res.json()) as TokenResp;
  if (!res.ok || !j.access_token) return { ok: false, error: j.error_description || j.error || `token refresh failed (${res.status})` };
  return { ok: true, accessToken: j.access_token };
}

/** 接続したGoogleアカウントのメールアドレスを取得。 */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { emailAddress?: string };
  return j.emailAddress ?? null;
}
