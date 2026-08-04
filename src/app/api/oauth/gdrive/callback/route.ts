import { NextResponse } from "next/server";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { exchangeCode, verifyOAuthState } from "@/lib/google-oauth";
import { encryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { fetchDriveAccountEmail } from "@/lib/storage/gdrive";
import { logAudit, clientIp } from "@/lib/audit-events";

export const dynamic = "force-dynamic";

/** P1 Googleドライブ組織接続のコールバック。code→トークン交換→暗号化保存。 */
export async function GET(req: Request) {
  const ctx = await requireCtx();
  const back = (q: string) => NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || ""}/app/settings?${q}`, 302);
  if (!(ctx.role === "owner" || ctx.role === "admin")) return back("error=forbidden");
  if (!mailCredSecretConfigured()) return back("error=no_secret");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return back(`error=gdrive_denied&detail=${encodeURIComponent(url.searchParams.get("error") || "")}`);
  if (!code || !verifyOAuthState(ctx.userId, state)) return back("error=gdrive_state");

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/oauth/gdrive/callback`;
  const tok = await exchangeCode(code, redirectUri);
  if (!tok.ok) return back(`error=gdrive_exchange&detail=${encodeURIComponent(tok.error.slice(0, 120))}`);

  const email = (await fetchDriveAccountEmail(tok.accessToken)) ?? ctx.email;
  const sb = getSupabaseServer(); // RLS: owner/admin のみ書込可
  const { data: existing } = await sb
    .from("tenant_storage_connections")
    .select("id, config")
    .eq("tenant_id", ctx.tenantId)
    .eq("provider", "gdrive")
    .maybeSingle();

  // 既存configは保持しつつ、今回付与されたスコープを記録(書込可否の判定に使う)
  const prevConfig = (existing?.config ?? {}) as Record<string, unknown>;
  const row = {
    tenant_id: ctx.tenantId,
    provider: "gdrive",
    display_name: email,
    auth_kind: "oauth_org",
    credentials: encryptSecret(tok.refreshToken),
    config: { ...prevConfig, scopes: tok.scope },
    status: "active",
    connected_by: ctx.userId,
  };
  const res = existing
    ? await sb.from("tenant_storage_connections").update(row).eq("id", existing.id)
    : await sb.from("tenant_storage_connections").insert(row);
  if (res.error) return back(`error=gdrive_save&detail=${encodeURIComponent(res.error.message.slice(0, 120))}`);

  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "storage.gdrive.connect", target: email, meta: { provider: "gdrive" }, ip: await clientIp() });
  return back("saved=gdrive_connected");
}
