import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { mailCredSecretConfigured } from "@/lib/crypto-mail";
import { getProvider } from "@/lib/storage/provider";
import { getActiveConnection } from "@/lib/storage/connections";
import "@/lib/storage/gdrive"; // アダプタ登録

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_PER_TENANT = 200; // 1回の実行でテナントあたり確認する上限(Drive APIレート配慮)

/**
 * P1 リンク健全性チェック(夜間)。documents(source_type='link')の
 * 存在・アクセス可否を確認し link_status を更新する。
 * ok→異常 への遷移時は登録者へアプリ内通知を出す(リンク切れの早期発見)。
 * 認可: Bearer CRON_SECRET。設計: docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md §3.7
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!mailCredSecretConfigured()) return NextResponse.json({ ok: false, error: "MAIL_CRED_SECRET未設定" }, { status: 503 });

  const admin = getSupabaseAdmin();
  const { data: conns } = await admin
    .from("tenant_storage_connections")
    .select("tenant_id, provider")
    .eq("status", "active");
  const tenantProviders = (conns ?? []) as { tenant_id: string; provider: string }[];
  if (tenantProviders.length === 0) return NextResponse.json({ ok: true, checked: 0, note: "接続なし" });

  let checked = 0, broken = 0, notified = 0, errors = 0;

  for (const tp of tenantProviders) {
    const provider = getProvider(tp.provider);
    if (!provider) continue;
    const conn = await getActiveConnection(tp.tenant_id, tp.provider);
    if (!conn) { errors++; continue; }

    // 未チェック→古い順に確認(1回の実行で全件を舐めない)
    const { data: docs } = await admin
      .from("documents")
      .select("id, external_id, title, link_status, target_type, target_id, created_by")
      .eq("tenant_id", tp.tenant_id)
      .eq("provider", tp.provider)
      .eq("source_type", "link")
      .order("health_checked_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_PER_TENANT);

    for (const d of (docs ?? []) as { id: string; external_id: string | null; title: string; link_status: string; target_type: string | null; target_id: string | null; created_by: string | null }[]) {
      if (!d.external_id) continue;
      let health: string;
      try {
        health = await provider.checkHealth(conn, d.external_id);
      } catch {
        errors++;
        continue;
      }
      checked++;
      if (health !== "ok") broken++;
      await admin.from("documents").update({ link_status: health, health_checked_at: new Date().toISOString() }).eq("id", d.id);

      // ok → 異常 の遷移時のみ通知(毎晩繰り返さない)
      if (d.link_status === "ok" && health !== "ok" && d.created_by) {
        const href =
          d.target_type === "opportunity" && d.target_id ? `/app/opportunities/${d.target_id}` :
          d.target_type === "account" && d.target_id ? `/app/accounts/${d.target_id}` : null;
        await admin.from("notifications").insert({
          tenant_id: tp.tenant_id,
          user_id: d.created_by,
          kind: "system",
          title: `ドライブ資料のリンク切れ: ${d.title.slice(0, 60)}`,
          body: health === "deleted" ? "ファイルが削除またはゴミ箱に移動されています" : "接続アカウントからアクセスできなくなっています",
          href,
        });
        notified++;
      }
    }
  }

  return NextResponse.json({ ok: true, checked, broken, notified, errors });
}
