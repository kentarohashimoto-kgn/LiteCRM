import { NextResponse } from "next/server";
import { checkBearer } from "@/lib/secure-compare";
import { runSeoIngest } from "@/lib/seo/run-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WO-30: SEO計測基盤の日次取込（F-301）。毎日04:00 JST。
 * 処理本体は lib/seo/run-ingest.ts（設定画面の手動実行と共通）。
 * 認可: Authorization: Bearer CRON_SECRET。停止: batch_job_settings(job_kind='seo_ingest')。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const result = await runSeoIngest("cron");
  return NextResponse.json(result, { status: result.error ? 503 : 200 });
}
