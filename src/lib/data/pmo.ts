/**
 * AI-PMO: CRM横断データ収集とレポート生成コア(サーバー専用データ層)。
 * 画面/Server Action(RLSクライアント)と夜間cron(service role)の両方から使うため、
 * Supabaseクライアントと tenant_id を引数で受け取る。
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PMO_MODE_MAP,
  PMO_SYSTEM_PROMPT,
  buildChannelDigest,
  buildPmoDigest,
  detectPmoAlerts,
  isActiveYomi,
  pmoModeInstruction,
  type PmoChannels,
  type PmoInput,
  type PmoMeetingRow,
  type PmoMode,
  type PmoMonthRow,
  type PmoOppRow,
  type PmoProjectRow,
  type PmoTaskRow,
} from "@/lib/pmo";

export const PMO_MODEL = "claude-opus-4-8";

// createServerClient(@supabase/ssr) と createClient(service role) の両方を受ける
// ため、スキーマ型は既定のままにする。
type Db = SupabaseClient;

/** JSTの今日(YYYY-MM-DD)。 */
export function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function monthKeyOf(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  return dateStr.slice(0, 7);
}

function addMonthsKey(base: Date, n: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + n, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * AI-PMOの入力データをCRM横断で収集する。
 * tenant_id は常に明示フィルタする(RLSクライアントでは冗長だが無害、
 * service role では必須。daily-digest cron と同じ方針)。
 */
export async function gatherPmoInput(sb: Db, tenantId: string): Promise<PmoInput> {
  const today = jstToday();
  const now = new Date(today + "T00:00:00Z");
  const d90 = new Date(now.getTime() - 90 * 86400_000).toISOString();
  const d45 = new Date(now.getTime() - 45 * 86400_000).toISOString().slice(0, 10);
  const d30 = new Date(now.getTime() - 30 * 86400_000).toISOString();

  const [oppRes, taskRes, meetingRes, planRes, reportRes, targetRes, profileRes] = await Promise.all([
    sb
      .from("opportunities")
      .select(
        "id, name, status, yomi, stage, amount, probability, expected_close_date, expected_revenue_month, next_action_date, next_action_text, last_activity_at, first_meeting_date, appointment_at, owner_user_id, is_project_managed, risk_level, competitor, updated_at, accounts(name)",
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .or(`status.eq.open,updated_at.gte.${d90}`)
      .limit(800),
    sb
      .from("tasks")
      .select("id, title, status, due_date, priority, assigned_to, opportunity_id, completed_at")
      .eq("tenant_id", tenantId)
      .or(`status.in.(todo,overdue),completed_at.gte.${d30}`)
      .limit(500),
    sb
      .from("meetings")
      .select("id, title, meeting_date, opportunity_id, summary, ai_summary, next_action_date, next_action_text, opportunities(name)")
      .eq("tenant_id", tenantId)
      .gte("meeting_date", d45)
      .order("meeting_date", { ascending: false })
      .limit(120),
    sb
      .from("project_plans")
      .select("id, opportunity_id, status, priority, start_month, end_month, opportunities(name, accounts(name))")
      .eq("tenant_id", tenantId)
      .limit(120),
    sb
      .from("project_weekly_reports")
      .select("plan_id, week_start, status, progress_pct, planned_mm, actual_mm, blockers")
      .eq("tenant_id", tenantId)
      .order("week_start", { ascending: false })
      .limit(400),
    sb.from("sales_targets").select("target_month, target_amount").eq("tenant_id", tenantId),
    sb.from("profiles").select("id, display_name, email"),
  ]);

  const nameOf = new Map<string, string>(
    ((profileRes.data ?? []) as { id: string; display_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.display_name ?? p.email ?? "—",
    ]),
  );

  const opps: PmoOppRow[] = ((oppRes.data ?? []) as unknown as (PmoOppRow & {
    owner_user_id: string | null;
    accounts: { name: string } | null;
  })[]).map((o) => ({
    ...o,
    account_name: o.accounts?.name ?? null,
    owner_name: o.owner_user_id ? (nameOf.get(o.owner_user_id) ?? null) : null,
  }));

  const tasks: PmoTaskRow[] = ((taskRes.data ?? []) as unknown as (PmoTaskRow & { assigned_to: string | null })[]).map(
    (t) => ({ ...t, assignee_name: t.assigned_to ? (nameOf.get(t.assigned_to) ?? null) : null }),
  );

  const meetings: PmoMeetingRow[] = ((meetingRes.data ?? []) as unknown as (PmoMeetingRow & {
    opportunities: { name: string } | null;
  })[]).map((m) => ({ ...m, opportunity_name: m.opportunities?.name ?? null }));

  // PJ: plan × 最新週次報告(plan_id毎の先頭 = week_start降順の最初)
  const latestByPlan = new Map<string, NonNullable<PmoProjectRow["latest_report"]>>();
  for (const r of (reportRes.data ?? []) as { plan_id: string; week_start: string | null; status: string | null; progress_pct: number | null; planned_mm: number | null; actual_mm: number | null; blockers: string | null }[]) {
    if (!latestByPlan.has(r.plan_id)) latestByPlan.set(r.plan_id, r);
  }
  const projects: PmoProjectRow[] = ((planRes.data ?? []) as unknown as {
    id: string;
    opportunity_id: string;
    status: string;
    priority: string | null;
    start_month: string | null;
    end_month: string | null;
    opportunities: { name: string; accounts: { name: string } | null } | null;
  }[]).map((p) => ({
    plan_id: p.id,
    opportunity_id: p.opportunity_id,
    name: p.opportunities?.name ?? "(案件名不明)",
    account_name: p.opportunities?.accounts?.name ?? null,
    status: p.status,
    priority: p.priority,
    start_month: p.start_month,
    end_month: p.end_month,
    latest_report: latestByPlan.get(p.id) ?? null,
  }));

  // 月次 目標 vs 実績 vs ヨミ加重(前2ヶ月〜先3ヶ月)
  const targetMap = new Map<string, number>(
    ((targetRes.data ?? []) as { target_month: string; target_amount: number | null }[]).map((t) => [
      t.target_month.slice(0, 7),
      t.target_amount ?? 0,
    ]),
  );
  const months: PmoMonthRow[] = [];
  for (let i = -2; i <= 3; i++) {
    const key = addMonthsKey(now, i);
    let actual = 0;
    let weighted = 0;
    for (const o of opps) {
      const mk = monthKeyOf(o.expected_close_date) ?? monthKeyOf(o.expected_revenue_month);
      if (mk !== key) continue;
      if (o.status === "won") actual += o.amount ?? 0;
      else if (o.status === "open" && isActiveYomi(o.yomi)) weighted += ((o.amount ?? 0) * (o.probability ?? 0)) / 100;
    }
    months.push({ month: key, target: targetMap.get(key) ?? 0, actual, weighted });
  }

  return { opps, tasks, meetings, projects, months, today };
}

/**
 * 流入元分析(営業分析モード)用のデータ収集。
 * 流入元別の月次受注・アポ推移(直近12ヶ月)とオープンパイプラインを集約する。
 * ページ描画では使わず、レポート生成時のみ呼ぶ(軽いが余計な負荷を画面に載せない)。
 */
export async function gatherPmoChannels(sb: Db, tenantId: string): Promise<PmoChannels> {
  const { data, error } = await sb.rpc("pmo_channel_stats", { p_tenant: tenantId });
  if (error || !data) {
    // RPC未整備の環境でも落とさない(セクションは空になる)。
    return { wonByMonth: [], apptByMonth: [], open: [] };
  }
  const d = data as {
    won_by_month?: { month: string; source: string; won_amt: number; won_cnt: number }[];
    appt_by_month?: { month: string; source: string; appt_cnt: number }[];
    open_by_source?: { source: string; open_cnt: number; open_amt: number; weighted: number }[];
  };
  return {
    wonByMonth: (d.won_by_month ?? []).map((r) => ({ month: r.month, source: r.source, wonAmt: Number(r.won_amt), wonCnt: Number(r.won_cnt) })),
    apptByMonth: (d.appt_by_month ?? []).map((r) => ({ month: r.month, source: r.source, apptCnt: Number(r.appt_cnt) })),
    open: (d.open_by_source ?? []).map((r) => ({ source: r.source, openCnt: Number(r.open_cnt), openAmt: Number(r.open_amt), weighted: Number(r.weighted) })),
  };
}

// ---------------------------------------------------------------------------
// レポート生成コア(Server Action と夜間cronで共有)
// ---------------------------------------------------------------------------

export type GeneratePmoResult = { ok: boolean; reportId?: string; error?: string };

/**
 * CRMデータ収集 → ヌケモレ検知 → Claude呼び出し → pmo_reports 保存。
 * createdBy は手動生成時のユーザーID。夜間バッチは null(無人実行)。
 */
export async function generateAndSavePmoReport(opts: {
  sb: Db;
  tenantId: string;
  mode: PmoMode;
  memo?: string;
  createdBy?: string | null;
  trigger?: "manual" | "nightly";
}): Promise<GeneratePmoResult> {
  const modeDef = PMO_MODE_MAP[opts.mode];
  if (!modeDef) return { ok: false, error: "不正なモードです" };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY が未設定です。Vercelの環境変数に設定するとAI-PMOが使えます。" };
  }
  const trigger = opts.trigger ?? "manual";

  const data = await gatherPmoInput(opts.sb, opts.tenantId);
  const alerts = detectPmoAlerts(data);
  // 営業分析モードは流入元別の月次成果を追加で収集して digest に含める。
  let channelDigest = "";
  if (opts.mode === "sales") {
    const channels = await gatherPmoChannels(opts.sb, opts.tenantId);
    channelDigest = "\n\n" + buildChannelDigest(channels);
  }
  const digest = buildPmoDigest(data, alerts) + channelDigest;

  const memo = (opts.memo ?? "").trim().slice(0, 2000);
  const userPrompt =
    pmoModeInstruction(opts.mode, data.today) +
    (memo ? `\n\n# 依頼者からの補足・関心事\n${memo}` : "") +
    "\n\n---CRMデータここから---\n" +
    digest.slice(0, 150_000) +
    "\n---CRMデータここまで---";

  const client = new Anthropic();
  let text = "";
  try {
    const response = await client.messages.create({
      model: PMO_MODEL,
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      system: PMO_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, error: "AIがレポートを生成できませんでした。再試行してください。" };
    }
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "APIキーが無効です" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "APIのレート制限中です。少し待って再試行してください" };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `AIレポート生成に失敗しました(${e.status})` };
    return { ok: false, error: "AIレポート生成に失敗しました(ネットワークエラー)" };
  }
  if (!text.trim()) return { ok: false, error: "レポートが空でした。再試行してください" };

  const { data: inserted, error } = await opts.sb
    .from("pmo_reports")
    .insert({
      tenant_id: opts.tenantId,
      mode: opts.mode,
      title: `${modeDef.label}（${data.today}${trigger === "nightly" ? " 夜間バッチ" : ""}）`,
      report_md: text.trim(),
      alerts: alerts.slice(0, 80),
      digest: {
        today: data.today,
        trigger,
        counts: {
          open_opps: data.opps.filter((o) => o.status === "open").length,
          tasks: data.tasks.length,
          meetings: data.meetings.length,
          projects: data.projects.length,
          alerts: alerts.length,
        },
        months: data.months,
        memo: memo || null,
      },
      model: PMO_MODEL,
      created_by: opts.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "レポートの保存に失敗しました" };

  return { ok: true, reportId: (inserted as { id: string }).id };
}
