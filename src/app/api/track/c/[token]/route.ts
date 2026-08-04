import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * WO-22 クリックトラッキング(F-101c)。送信HTML内のラップされたリンクを経由すると、
 * どのリンク(資料)がクリックされたかを記録し、実URLへ302リダイレクトする。
 * トークンが不正/期限切れなら安全にアプリのトップへ。
 */
export async function GET(req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const token = params.token;
  const fallback = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  if (!token) return NextResponse.redirect(fallback, 302);

  let dest: string | null = null;
  try {
    const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
    const ipRaw = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ipHash = ipRaw ? createHash("sha256").update(ipRaw).digest("hex").slice(0, 32) : null;
    const { data } = await getSupabaseAdmin().rpc("track_email_click", { p_token: token, p_ua: ua, p_ip: ipHash });
    dest = typeof data === "string" ? data : null;
  } catch {
    dest = null;
  }

  // オープンリダイレクト防止: http(s) のみ許可
  if (dest && /^https?:\/\//i.test(dest)) {
    return NextResponse.redirect(dest, 302);
  }
  return NextResponse.redirect(fallback, 302);
}
