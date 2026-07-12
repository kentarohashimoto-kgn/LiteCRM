import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCtxOrNull } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exchangeCodeForToken, FreeeClient } from "@/lib/freee/client";

export const dynamic = "force-dynamic";

const APP = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const back = (params: string) => NextResponse.redirect(new URL(`/app/settings/freee?${params}`, APP()));

/**
 * freee OAuth コールバック。認可コードをトークンに交換し、事業所を取得して
 * freee_connections に保存する（トークンは service role のみ読める領域）。
 */
export async function GET(req: Request) {
  const ctx = await getCtxOrNull();
  if (!ctx || !["finance", "owner", "admin"].includes(ctx.role)) {
    return NextResponse.redirect(new URL("/app/dashboard", APP()));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent("freee連携がキャンセルされました")}`);
  if (!code) return back(`error=${encodeURIComponent("認可コードがありません")}`);

  const expected = cookies().get("freee_oauth_state")?.value;
  if (!expected || expected !== state) {
    return back(`error=${encodeURIComponent("stateが一致しません。お手数ですが再度お試しください")}`);
  }

  try {
    const tok = await exchangeCodeForToken(code);
    // 事業所を取得（複数ある場合は先頭を採用。後で切替UIを追加可能）
    const client = new FreeeClient(tok.access_token, {
      id: "", tenant_id: ctx.tenantId, company_id: null, company_name: null,
      access_token: tok.access_token, refresh_token: tok.refresh_token, token_expires_at: null,
    });
    let companyId: number | null = null;
    let companyName: string | null = null;
    try {
      const res = await client.api<{ companies: { id: number; display_name: string; name: string }[] }>("/api/1/companies");
      const c = res.companies?.[0];
      if (c) { companyId = c.id; companyName = c.display_name || c.name; }
    } catch {
      /* company取得失敗でも接続自体は保存する */
    }

    const admin = getSupabaseAdmin();
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
    await admin.from("freee_connections").upsert(
      {
        tenant_id: ctx.tenantId,
        company_id: companyId,
        company_name: companyName,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        token_expires_at: expiresAt,
        connected_by: ctx.userId,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    cookies().delete("freee_oauth_state");
    return back(`ok=${encodeURIComponent("freeeに接続しました" + (companyName ? `（${companyName}）` : ""))}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "接続に失敗しました";
    return back(`error=${encodeURIComponent(msg)}`);
  }
}
