import { NextResponse } from "next/server";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { exchangeCode, fetchGoogleEmail, verifyOAuthState } from "@/lib/google-oauth";
import { encryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { logAudit, clientIp } from "@/lib/audit-events";

export const dynamic = "force-dynamic";

/** WO-25 Google OAuth コールバック。code→トークン交換→リフレッシュトークンを暗号化保存。 */
export async function GET(req: Request) {
  const ctx = await requireCtx();
  const back = (q: string) => NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ""}/app/email/account?${q}`, 302);
  if (!mailCredSecretConfigured()) return back("error=no_secret");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return back(`error=google_denied&detail=${encodeURIComponent(url.searchParams.get("error") || "")}`);
  if (!code || !verifyOAuthState(ctx.userId, state)) return back("error=google_state");

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/oauth/google/callback`;
  const tok = await exchangeCode(code, redirectUri);
  if (!tok.ok) return back(`error=google_exchange&detail=${encodeURIComponent(tok.error.slice(0, 120))}`);

  // アドレスが取れないまま保存すると、送信元が不正な値(ユーザーID等)のまま
  // 「接続成功」に見えてしまう。取得できなければ保存せずエラーにする。
  const info = await fetchGoogleEmail(tok.accessToken);
  const email = info.email;
  if (!email) return back("error=google_profile");

  const sb = getSupabaseServer();
  const { data: existing } = await sb.from("user_mail_accounts").select("id").eq("user_id", ctx.userId).maybeSingle();

  const row = {
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    provider: "gws",
    auth_method: "google_oauth",
    oauth_refresh_token_enc: encryptSecret(tok.refreshToken),
    oauth_email: email,
    from_email: email,
    status: "active",
    verified_at: new Date().toISOString(),
    inbound_enabled: true, // Google接続=受信も取り込む前提で接続
    imap_host: null,
  };
  const res = existing
    ? await sb.from("user_mail_accounts").update(row).eq("id", existing.id)
    : await sb.from("user_mail_accounts").insert(row);
  if (res.error) return back(`error=save_failed&detail=${encodeURIComponent(res.error.message.slice(0, 120))}`);

  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "mail.account.google_connect", target: email, meta: { provider: "gws", gmail_api_ready: info.gmailApiReady }, ip: clientIp() });
  // 保存はできたがGmail APIが未有効の場合、そのまま送信すると失敗する。接続時点で気づけるようにする。
  return back(info.gmailApiReady ? "saved=google_connected" : "error=gmail_api_disabled");
}
