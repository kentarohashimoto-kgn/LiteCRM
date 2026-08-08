import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { generateAndSavePmoReport, jstToday } from "@/lib/data/pmo";
import { PMO_MODES, type PmoMode } from "@/lib/pmo";

export const dynamic = "force-dynamic";
// Claude呼び出し(4モード並列)を含むため長め(Proプラン上限)。
export const maxDuration = 300;

/**
 * AI-PMO 週次バッチ(Vercel Cronから毎週日曜23時JST=日曜14:00 UTCに起動)。
 * 4モード(振り返りPDCA/未来段取り/案件PJ管理/経営俯瞰)のレポートを
 * 自動生成し pmo_reports へ保存する。月曜朝イチで最新レポートが読める状態にする。
 * ※以前は毎晩実行だったが、API料金節約のため週1回(日曜夜)に変更した。
 *   平日に必要になった場合はAI-PMO画面から手動生成できる。
 *
 * - 停止スイッチ: batch_job_settings(job_kind='pmo_nightly')。AIバッチ運用画面で制御
 * - 冪等: 同一JST日に同モードのレポートが既にあればスキップ(cron再実行に耐える)
 * - 実行ログ: batch_runs(job_kind='pmo_nightly')
 * - 認可: Authorization: Bearer <CRON_SECRET>(fail-closed)
 * - 手動実行: ?modes=retrospective,planning で対象モードを絞れる
 */

// CATORCE 単一テナント。多テナント化時はテナントごとにループ化する。
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // アプリ側の停止スイッチ(設定行が無い場合は稼働扱い=既存ジョブと同方針)
  const { data: setting } = await admin
    .from("batch_job_settings")
    .select("enabled")
    .eq("tenant_id", TENANT_ID)
    .eq("job_kind", "pmo_nightly")
    .maybeSingle();
  if (setting && !setting.enabled) {
    return NextResponse.json({ ok: true, enabled: false, message: "AI-PMO夜間レポートはアプリ側で停止中です（AIバッチ運用画面で再開できます）。" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY が未設定です" }, { status: 503 });
  }

  // 対象モード(既定は全4モード)
  const allModes = PMO_MODES.map((m) => m.key);
  const url = new URL(req.url);
  const modesParam = (url.searchParams.get("modes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is PmoMode => (allModes as string[]).includes(s));
  const modes: PmoMode[] = modesParam.length > 0 ? modesParam : allModes;

  const today = jstToday();
  const jstMidnightIso = new Date(`${today}T00:00:00+09:00`).toISOString();
  const startedAt = new Date().toISOString();

  // 冪等: 今日(JST)すでに生成済みのモードはスキップ
  const { data: existing } = await admin
    .from("pmo_reports")
    .select("mode")
    .eq("tenant_id", TENANT_ID)
    .gte("created_at", jstMidnightIso)
    .in("mode", modes);
  const done = new Set((existing ?? []).map((r) => r.mode as string));
  const targets = modes.filter((m) => !done.has(m));

  // 4モードを並列生成(直列だとVercelの実行時間上限に触れるため)
  const results = await Promise.all(
    targets.map(async (mode) => {
      try {
        const res = await generateAndSavePmoReport({
          sb: admin,
          tenantId: TENANT_ID,
          mode,
          createdBy: null,
          trigger: "nightly",
        });
        return { mode, ...res };
      } catch {
        return { mode, ok: false as const, error: "unexpected error" };
      }
    }),
  );

  const generated = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const status = failed === 0 ? "success" : generated > 0 ? "partial" : "error";

  await admin.from("batch_runs").insert({
    tenant_id: TENANT_ID,
    job_kind: "pmo_nightly",
    run_date: today,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    status: targets.length === 0 ? "success" : status,
    targets_total: targets.length,
    items_generated: generated,
    items_failed: failed,
    detail: {
      trigger: "nightly",
      requested_modes: modes,
      skipped_existing: modes.filter((m) => done.has(m)),
      results: results.map((r) => ({ mode: r.mode, ok: r.ok, reportId: r.reportId ?? null, error: r.error ?? null })),
    },
  });

  return NextResponse.json({
    ok: failed === 0,
    generated,
    failed,
    skipped: modes.length - targets.length,
    results,
  });
}
