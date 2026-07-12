import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * 営業レントゲンの月次スナップショット自動保存(Vercel Cronから毎日起動)。
 * JST基準で「前月」の月次スナップショットが無ければ作成する。
 * 月初(1日)に前月末時点の分析が保存され、cron失敗時も翌日以降に自己修復する(冪等)。
 * 必要な環境変数: CRON_SECRET(認可)。
 */
export async function GET(req: Request) {
  // fail-closed: CRON_SECRET 未設定なら拒否(監査2026-07-12。従来は未設定時に素通しだった)
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();

  // JSTの現在から前月[1日,翌月1日)と比較期間(前々月)を導出
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = nowJst.getUTCFullYear();
  const m = nowJst.getUTCMonth();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const prevStart = new Date(Date.UTC(y, m - 1, 1));
  const prevEnd = new Date(Date.UTC(y, m, 1));
  const cmpStart = new Date(Date.UTC(y, m - 2, 1));
  const label = `${prevStart.getUTCFullYear()}年${prevStart.getUTCMonth() + 1}月 月次診断`;

  const { data: tenants } = await admin.from("tenants").select("id");
  const results: Record<string, string> = {};

  for (const t of tenants ?? []) {
    const tid = t.id as string;
    const { data: exists } = await admin
      .from("xray_snapshots")
      .select("id")
      .eq("tenant_id", tid)
      .eq("kind", "monthly")
      .eq("period_start", fmt(prevStart))
      .limit(1)
      .maybeSingle();
    if (exists) {
      results[tid] = "exists";
      continue;
    }
    const { data: payload, error } = await admin.rpc("xray_metrics_for_tenant", {
      p_tenant: tid,
      p_start: fmt(prevStart),
      p_end: fmt(prevEnd),
      p_cmp_start: fmt(cmpStart),
      p_cmp_end: fmt(prevStart),
    });
    if (error || !payload || !(payload as Record<string, unknown>).cur) {
      results[tid] = "rpc_error";
      continue;
    }
    const { error: insErr } = await admin.from("xray_snapshots").insert({
      tenant_id: tid,
      kind: "monthly",
      label,
      period_start: fmt(prevStart),
      period_end: fmt(prevEnd),
      cmp_start: fmt(cmpStart),
      cmp_end: fmt(prevStart),
      payload,
    });
    results[tid] = insErr ? `insert_error: ${insErr.message}` : "created";
  }

  return NextResponse.json({ ok: true, month: fmt(prevStart), results });
}
