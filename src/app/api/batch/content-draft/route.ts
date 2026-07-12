import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * F1: 夜間バッチ用 ingest API — 記事ドラフト生成(B8 / 方針A・従量課金ゼロ)。
 *
 * 夜間の Claude Code セッションが:
 *   GET  … 「選定済み(status='selected')で本文未作成」の記事ネタを取得
 *          → セッション自身(サブスク枠)がSEO記事をMarkdownで執筆
 *   POST … 本文(body_md)を書き戻し(status→'drafting'、デザイン連携待ち design_status→'ready')
 *          + batch_runs にログ
 *
 * 認可: Authorization: Bearer <CRON_SECRET>。未設定時は503。
 * 書込は service role。単一テナント運用。
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_LIMIT = 5; // 1日5本(要望)

function authFail(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET が未設定です（管理者に連絡）。" }, { status: 503 });
  }
  if (!checkBearer(req, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function jstDate(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** アプリ側のスタート/停止設定(batch_job_settings)。停止中はGET=対象0件/POST=409。 */
async function jobDisabled(): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("batch_job_settings")
    .select("enabled")
    .eq("tenant_id", TENANT_ID)
    .eq("job_kind", "content_draft")
    .maybeSingle();
  return data ? !data.enabled : false; // 設定行が無い場合は従来どおり稼働
}

/** GET /api/batch/content-draft?limit=5 — 執筆対象の記事ネタを返す。 */
export async function GET(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;
  if (await jobDisabled()) {
    return NextResponse.json({ ok: true, enabled: false, count: 0, targets: [], message: "AI記事作成はアプリ側で停止中です（AIバッチ運用画面で再開できます）。" });
  }

  const url = new URL(req.url);
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("content_ideas")
    .select("id,title,theme,angle,target_keyword,note")
    .eq("tenant_id", TENANT_ID)
    .eq("status", "selected")
    .or("body_md.is.null,body_md.eq.")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: (data ?? []).length, targets: data ?? [] });
}

type IngestItem = { id: string; body_md: string };
type IngestBody = {
  items: IngestItem[];
  targets_total?: number;
  deferred_count?: number;
  limit_hit?: boolean;
  limit_hit_at?: string | null;
  usage_note?: string;
  trigger?: string;
};

/** POST /api/batch/content-draft — 記事本文を書き戻し、batch_runs にログ。 */
export async function POST(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;
  if (await jobDisabled()) {
    return NextResponse.json({ ok: false, enabled: false, error: "AI記事作成はアプリ側で停止中のため書き戻しできません。" }, { status: 409 });
  }

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
    const md = (it?.body_md ?? "").trim();
    if (!it?.id || md.length < 100) {
      failed += 1;
      continue;
    }
    // 冪等: 本文が未作成のものだけ書く(人が編集済みの本文は上書きしない)。
    // 書けたら status→drafting、デザイン連携待ち design_status→ready。
    const { data, error } = await admin
      .from("content_ideas")
      .update({ body_md: md, status: "drafting", design_status: "ready" })
      .eq("id", it.id)
      .eq("tenant_id", TENANT_ID)
      .or("body_md.is.null,body_md.eq.")
      .select("id");
    if (error || !data || data.length === 0) failed += 1;
    else {
      generated += 1;
      doneIds.push(it.id);
    }
  }

  const status = failed === 0 ? "success" : generated > 0 ? "partial" : "error";
  const { data: runRow } = await admin
    .from("batch_runs")
    .insert({
      tenant_id: TENANT_ID,
      job_kind: "content_draft",
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
      detail: { trigger: body.trigger ?? "nightly", source: "ingest_api", content_ids: doneIds },
    })
    .select("id")
    .maybeSingle();

  return NextResponse.json({ ok: true, generated, failed, batch_run_id: runRow?.id ?? null });
}
