import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * F1: 夜間バッチ用 ingest API（方針A / Claude Code方式・従量課金ゼロ）。
 *
 * 夜間の Claude Code セッションは Supabase MCP を持たないため、DB読み書きを本APIに委譲する:
 *   GET  … 議事録要約が必要な商談(対象)を返す → セッションが自分(サブスク枠)で要約を生成
 *   POST … 生成した要約を受け取り meetings.ai_summary へ書き戻し + batch_runs にログ
 *
 * 認可: Authorization: Bearer <CRON_SECRET>。CRON_SECRET 未設定時は 503（無防備な書込を許さない）。
 * 書込は service role（getSupabaseAdmin, RLSバイパス）。単一テナント運用。
 */

// CATORCE 単一テナント。多テナント化時はテナントごとにループ化する。
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const RECENT_DAYS = 7; // runbook と揃える
const DEFAULT_LIMIT = 10;

function authFail(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET が未設定です（管理者に連絡）。" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/** JSTの日付文字列(YYYY-MM-DD)。 */
function jstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

type MeetingRow = {
  id: string;
  title: string | null;
  meeting_date: string | null;
  minutes_detail: string | null;
  opportunities: { name: string | null } | null;
  accounts: { name: string | null } | null;
};

/** GET /api/batch/meeting-summary?limit=10 — 要約対象の商談を返す。 */
export async function GET(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  const admin = getSupabaseAdmin();
  // 候補を広めに取り、議事録の文字数(>=30)は後段でフィルタ。
  const { data, error } = await admin
    .from("meetings")
    .select("id,title,meeting_date,minutes_detail,opportunities(name),accounts(name)")
    .eq("tenant_id", TENANT_ID)
    .gte("meeting_date", jstDate(-RECENT_DAYS))
    .or("ai_summary.is.null,ai_summary.eq.")
    .order("meeting_date", { ascending: true })
    .limit(limit * 3);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const targets = ((data ?? []) as unknown as MeetingRow[])
    .filter((m) => (m.minutes_detail ?? "").trim().length >= 30)
    .slice(0, limit)
    .map((m) => ({
      meeting_id: m.id,
      title: m.title,
      meeting_date: m.meeting_date,
      opp_name: m.opportunities?.name ?? null,
      acc_name: m.accounts?.name ?? null,
      minutes_detail: (m.minutes_detail ?? "").slice(0, 100_000),
    }));

  return NextResponse.json({ ok: true, count: targets.length, targets });
}

type IngestItem = { meeting_id: string; ai_summary: string };
type IngestBody = {
  items: IngestItem[];
  targets_total?: number;
  deferred_count?: number;
  limit_hit?: boolean;
  limit_hit_at?: string | null;
  usage_note?: string;
  trigger?: string; // 'nightly' 等
};

/** POST /api/batch/meeting-summary — 生成した要約を書き戻し、batch_runs にログ。 */
export async function POST(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  const startedAt = new Date().toISOString();

  const admin = getSupabaseAdmin();
  let generated = 0;
  let failed = 0;
  const doneIds: string[] = [];

  for (const it of items) {
    const summary = (it?.ai_summary ?? "").trim();
    if (!it?.meeting_id || summary.length < 10) {
      failed += 1;
      continue;
    }
    // 冪等: 未要約(null/空)のものだけ書く。人が編集済みの要約は上書きしない。
    const { data, error } = await admin
      .from("meetings")
      .update({ ai_summary: summary, ai_summary_at: new Date().toISOString() })
      .eq("id", it.meeting_id)
      .eq("tenant_id", TENANT_ID)
      .or("ai_summary.is.null,ai_summary.eq.")
      .select("id");
    if (error || !data || data.length === 0) {
      failed += 1;
    } else {
      generated += 1;
      doneIds.push(it.meeting_id);
    }
  }

  const status = failed === 0 ? "success" : generated > 0 ? "partial" : "error";
  const { data: runRow } = await admin
    .from("batch_runs")
    .insert({
      tenant_id: TENANT_ID,
      job_kind: "meeting_summary",
      run_date: jstDate(),
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      status,
      targets_total: body.targets_total ?? items.length,
      items_generated: generated,
      items_failed: failed,
      deferred_count: body.deferred_count ?? 0,
      limit_hit: body.limit_hit ?? false,
      limit_hit_at: body.limit_hit_at ?? null,
      usage_note: body.usage_note ?? null,
      detail: { trigger: body.trigger ?? "nightly", source: "ingest_api", meeting_ids: doneIds },
    })
    .select("id")
    .maybeSingle();

  return NextResponse.json({ ok: true, generated, failed, batch_run_id: runRow?.id ?? null });
}
