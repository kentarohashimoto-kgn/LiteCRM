import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * ウォームアップ用エンドポイント。
 * 定期的に叩くことでサーバーレス関数とDB接続を温存し、初回/アイドル後の
 * コールドスタート遅延を軽減する(vercel.json の cron から呼び出し)。
 */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("tenants").select("id", { head: true, count: "exact" });
    return NextResponse.json({ ok: true, t: Date.now() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
