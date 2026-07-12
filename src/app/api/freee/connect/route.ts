import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCtxOrNull } from "@/lib/session";
import { freeeAuthorizeUrl } from "@/lib/freee/client";

export const dynamic = "force-dynamic";

/**
 * freee OAuth 認可の開始。経理(finance)/代表/管理者のみ。
 * CSRF対策の state を Cookie に控え、freee の認可画面へリダイレクトする。
 */
export async function GET() {
  const ctx = await getCtxOrNull();
  if (!ctx || !["finance", "owner", "admin"].includes(ctx.role)) {
    return NextResponse.redirect(new URL("/app/dashboard", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  }
  let state: string;
  try {
    state = crypto.randomUUID();
  } catch {
    state = `${ctx.tenantId}-${Date.now()}`;
  }
  cookies().set("freee_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });

  try {
    return NextResponse.redirect(freeeAuthorizeUrl(state));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "設定エラー";
    return NextResponse.redirect(new URL(`/app/settings/freee?error=${encodeURIComponent(msg)}`, process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  }
}
