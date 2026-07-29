import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WO-34: 提案のAI肉付け（方針A / 夜間 Claude Code セッション・従量課金ゼロ）。
 *
 * 提案そのもの（対象・期待値・優先度）はアプリが決定的に生成済み。
 * このAPIでAIが書き足すのは **なぜ効くか(hypothesis)** と
 * **具体的に何をするか(plan_md)** の2つだけ。
 * 数値をAIに再計算させると日によって順序が揺れ、PDCAが続かないため。
 *
 *   GET  … 未生成の提案と、その根拠数値を返す
 *   POST … {items:[{proposal_id, hypothesis, plan_md}], usage_note} を書き戻す
 *
 * 認可: Authorization: Bearer CRON_SECRET。
 * 停止: batch_job_settings(job_kind='seo_proposal') が false なら GET=0件 / POST=409。
 *
 * ★AIに渡さないもの: 顧客名・商談内容などの個別情報。
 *   渡すのは公開情報であるSEO指標と、集計済みのレートのみ。
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_LIMIT = 10;

function authFail(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return null;
}

async function jobDisabled(): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("batch_job_settings")
    .select("enabled")
    .eq("tenant_id", TENANT_ID)
    .eq("job_kind", "seo_proposal")
    .maybeSingle();
  return data ? !data.enabled : true; // 設定行が無ければ安全側で停止扱い
}

/** GET /api/batch/seo-proposal?limit=10 — 仮説・打ち手が未記入の提案を返す。 */
export async function GET(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;
  if (await jobDisabled()) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      count: 0,
      targets: [],
      message: "SEO提案のAI肉付けはアプリ側で停止中です（AIバッチ運用画面で開始できます）。",
    });
  }

  const url = new URL(req.url);
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("seo_proposals")
    .select(
      "id, title, action_type, lever, intent_layer, target_query, target_page, evidence_json, expected_json, ice_score, seo_sites(name, base_url, audience)",
    )
    .eq("tenant_id", TENANT_ID)
    .eq("status", "pending_review")
    .is("hypothesis", null)
    .order("ice_score", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const targets = (data ?? []).map((r) => {
    const site = (r as { seo_sites?: { name?: string; base_url?: string; audience?: string } }).seo_sites;
    return {
      proposal_id: r.id,
      site: site?.name ?? null,
      base_url: site?.base_url ?? null,
      audience: site?.audience ?? null,
      title: r.title,
      action_type: r.action_type,
      lever: r.lever,
      intent_layer: r.intent_layer,
      target_query: r.target_query || null,
      target_page: r.target_page || null,
      evidence: r.evidence_json,
      expected: r.expected_json,
    };
  });

  return NextResponse.json({
    ok: true,
    enabled: true,
    count: targets.length,
    targets,
    instruction:
      "各 target について、(1)hypothesis: なぜこの施策が効くと考えるか（evidenceの数値を引用して2〜4文）"
      + " (2)plan_md: 具体的に何をどう変えるか（箇条書き3〜6行。タイトル改善なら案を3つ）を日本語で書き、"
      + " POST で書き戻してください。数値の再計算はしないでください（expected はアプリが確定済みです）。",
  });
}

/** POST /api/batch/seo-proposal — 生成結果を書き戻す。 */
export async function POST(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;
  if (await jobDisabled()) {
    return NextResponse.json({ ok: false, error: "job disabled" }, { status: 409 });
  }

  let body: { items?: Array<{ proposal_id?: string; hypothesis?: string; plan_md?: string }>; usage_note?: string; trigger?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const items = (body.items ?? []).filter((i) => i.proposal_id && i.hypothesis);
  if (!items.length) return NextResponse.json({ ok: false, error: "items is empty" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  let generated = 0;
  let failed = 0;

  for (const item of items) {
    const { error } = await admin
      .from("seo_proposals")
      .update({
        hypothesis: (item.hypothesis ?? "").slice(0, 2000),
        plan_md: (item.plan_md ?? "").slice(0, 4000) || null,
        ai_generated_at: new Date().toISOString(),
      })
      .eq("id", item.proposal_id as string)
      .eq("tenant_id", TENANT_ID);
    if (error) failed += 1;
    else generated += 1;
  }

  const runDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: run } = await admin
    .from("batch_runs")
    .insert({
      tenant_id: TENANT_ID,
      job_kind: "seo_proposal",
      run_date: runDate,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      status: failed ? "partial" : "success",
      targets_total: items.length,
      items_generated: generated,
      items_failed: failed,
      usage_note: body.usage_note ?? null,
      detail: { trigger: body.trigger ?? "nightly" },
    })
    .select("id")
    .maybeSingle();

  return NextResponse.json({ ok: true, generated, failed, batch_run_id: run?.id ?? null });
}
