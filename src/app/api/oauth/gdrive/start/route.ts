import { NextResponse } from "next/server";
import { requireCtx } from "@/lib/session";
import { buildGoogleAuthUrl, signOAuthState, googleOAuthConfigured } from "@/lib/google-oauth";
import { mailCredSecretConfigured } from "@/lib/crypto-mail";
import { GDRIVE_SCOPES } from "@/lib/storage/gdrive";

export const dynamic = "force-dynamic";

/**
 * P1 Googleドライブ組織接続の開始(owner/adminのみ)。
 * テナント代表アカウントで drive.readonly を許可し、リンク解決・
 * ヘルスチェック・(将来)AIインデックスの読取に使う。
 * ※OAuthクライアントの承認済みリダイレクトURIに
 *   <NEXT_PUBLIC_APP_URL>/api/oauth/gdrive/callback の追加が必要。
 */
export async function GET() {
  const ctx = await requireCtx();
  const back = (q: string) => NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ""}/app/settings?${q}`, 302);
  if (!(ctx.role === "owner" || ctx.role === "admin")) return back("error=forbidden");
  if (!googleOAuthConfigured()) return back("error=no_google");
  if (!mailCredSecretConfigured()) return back("error=no_secret");

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/oauth/gdrive/callback`;
  const url = buildGoogleAuthUrl(redirectUri, signOAuthState(ctx.userId), GDRIVE_SCOPES);
  return NextResponse.redirect(url, 302);
}
