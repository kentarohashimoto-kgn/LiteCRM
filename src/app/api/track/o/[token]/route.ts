import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// 1×1 透明GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function pixelResponse() {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

/**
 * WO-22 開封トラッキング(F-101c)。送信HTMLに埋め込んだ1×1ピクセルが取得されると開封として記録。
 * ※ 開封は近似値(Gmailプロキシ/Appleのプリフェッチで誤差)。常にピクセルを返す(トークン不正でも)。
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const token = params.token?.replace(/\.gif$/, "");
  if (token) {
    try {
      const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
      const ipRaw = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
      const ipHash = ipRaw ? createHash("sha256").update(ipRaw).digest("hex").slice(0, 32) : null;
      await getSupabaseAdmin().rpc("track_email_open", { p_token: token, p_ua: ua, p_ip: ipHash });
    } catch {
      /* 記録失敗でもピクセルは返す(メール表示を壊さない) */
    }
  }
  return pixelResponse();
}
