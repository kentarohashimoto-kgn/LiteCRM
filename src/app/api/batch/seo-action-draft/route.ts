import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WO-35: 成果物のAI生成（方針A / 夜間 Claude Code セッション・従量課金ゼロ）。
 *
 * 指示書は既に決定的テンプレートで生成済みで、そのままHP担当へ渡せる状態。
 * このAPIでAIが作るのは「案の中身」— タイトル案3つ、メタ案、改訂稿など。
 *
 *   GET  … 承認済みで案が未生成の施策を返す（対象ページの現況つき）
 *   POST … {items:[{action_id, options, deliverable_md}]} を書き戻す
 *
 * 認可: Authorization: Bearer CRON_SECRET。
 * 停止: batch_job_settings(job_kind='seo_action_draft') が false なら GET=0件 / POST=409。
 *
 * ★公開は必ず人が行う。このAPIはHP本体に書き込まない（設計 §7.2 G1）。
 */

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_LIMIT = 5;

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
    .eq("job_kind", "seo_action_draft")
    .maybeSingle();
  return data ? !data.enabled : true;
}

export async function GET(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;
  if (await jobDisabled()) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      count: 0,
      targets: [],
      message: "SEO成果物のAI生成はアプリ側で停止中です（AIバッチ運用画面で開始できます）。",
    });
  }

  const url = new URL(req.url);
  const limit = Math.min(10, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("seo_actions")
    .select(
      "id, title, action_type, target_query, target_page, expected_json, seo_sites(name, base_url, audience), seo_proposals(evidence_json, hypothesis)",
    )
    .eq("tenant_id", TENANT_ID)
    .in("status", ["todo", "in_progress"])
    .is("options_json", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const targets = (data ?? []).map((r) => {
    const site = (r as { seo_sites?: { name?: string; base_url?: string; audience?: string } }).seo_sites;
    const prop = (r as { seo_proposals?: { evidence_json?: unknown; hypothesis?: string } }).seo_proposals;
    return {
      action_id: r.id,
      site: site?.name ?? null,
      base_url: site?.base_url ?? null,
      audience: site?.audience ?? null,
      title: r.title,
      action_type: r.action_type,
      target_query: r.target_query || null,
      target_page: r.target_page || null,
      evidence: prop?.evidence_json ?? {},
      hypothesis: prop?.hypothesis ?? null,
      expected: r.expected_json,
    };
  });

  return NextResponse.json({
    ok: true,
    enabled: true,
    count: targets.length,
    targets,
    instruction:
      "各 target の action_type に応じて成果物を作り、POSTで書き戻してください。"
      + " title_meta: options に {titles:[3案], metas:[2案]} を入れる（対象KWをタイトル前半に、全角30文字前後）。"
      + " internal_link: options に {links:[{fromPageHint, anchorText}]} を入れる。"
      + " rewrite/new_article: deliverable_md に構成案（H2/H3の見出し構成と各節の要点）を書く。"
      + " 実績のない数字・誇大表現は書かないでください。公開は人が行います。",
  });
}

export async function POST(req: Request) {
  const fail = authFail(req);
  if (fail) return fail;
  if (await jobDisabled()) return NextResponse.json({ ok: false, error: "job disabled" }, { status: 409 });

  let body: {
    items?: Array<{ action_id?: string; options?: unknown; deliverable_md?: string }>;
    usage_note?: string;
    trigger?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const items = (body.items ?? []).filter((i) => i.action_id && (i.options || i.deliverable_md));
  if (!items.length) return NextResponse.json({ ok: false, error: "items is empty" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  let generated = 0;
  let failed = 0;

  for (const item of items) {
    // 既存の指示書は消さず、AIの案を追記する（決定的テンプレートの内容を失わないため）
    const { data: cur } = await admin
      .from("seo_actions")
      .select("deliverable_md")
      .eq("id", item.action_id as string)
      .eq("tenant_id", TENANT_ID)
      .maybeSingle();
    if (!cur) {
      failed += 1;
      continue;
    }
    const appended = item.deliverable_md
      ? `${cur.deliverable_md ?? ""}\n\n## AIが作成した案\n${item.deliverable_md.slice(0, 8000)}`
      : (cur.deliverable_md ?? null);

    const { error } = await admin
      .from("seo_actions")
      .update({
        options_json: (item.options as Record<string, unknown>) ?? {},
        deliverable_md: appended,
        ai_generated_at: new Date().toISOString(),
        status: "review",
      })
      .eq("id", item.action_id as string)
      .eq("tenant_id", TENANT_ID);
    if (error) failed += 1;
    else generated += 1;
  }

  const runDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: run } = await admin
    .from("batch_runs")
    .insert({
      tenant_id: TENANT_ID,
      job_kind: "seo_action_draft",
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
