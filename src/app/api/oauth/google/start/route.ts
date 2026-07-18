import { NextResponse } from "next/server";
import { requireCtx } from "@/lib/session";
import { buildGoogleAuthUrl, signOAuthState, googleOAuthConfigured } from "@/lib/google-oauth";
import { mailCredSecretConfigured } from "@/lib/crypto-mail";

export const dynamic = "force-dynamic";

/** WO-25 Google OAuth 開始。ログインユーザーをGoogleの同意画面へリダイレクト。 */
export async function GET() {
  const ctx = await requireCtx();
  const base = (q: string) => NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ""}/app/email/account?${q}`, 302);
  if (!googleOAuthConfigured()) return base("error=no_google");
  if (!mailCredSecretConfigured()) return base("error=no_secret");

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/oauth/google/callback`;
  const url = buildGoogleAuthUrl(redirectUri, signOAuthState(ctx.userId));
  return NextResponse.redirect(url, 302);
}
