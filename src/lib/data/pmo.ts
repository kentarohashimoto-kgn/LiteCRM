/** AI-PMO: CRM横断データ収集(サーバー専用データ層)。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  type PmoInput,
  type PmoMeetingRow,
  type PmoMonthRow,
  type PmoOppRow,
  type PmoProjectRow,
  type PmoTaskRow,
  isActiveYomi,
} from "@/lib/pmo";

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
 * AI-PMOの入力データをCRM横断で収集する(RLSスコープ)。
 * 画面のルールベースアラート表示と、AIレポート生成の両方で使う。
 */
export async function gatherPmoInput(): Promise<PmoInput> {
  const sb = getSupabaseServer();
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
      .is("deleted_at", null)
      .or(`status.eq.open,updated_at.gte.${d90}`)
      .limit(800),
    sb
      .from("tasks")
      .select("id, title, status, due_date, priority, assigned_to, opportunity_id, completed_at")
      .or(`status.in.(todo,overdue),completed_at.gte.${d30}`)
      .limit(500),
    sb
      .from("meetings")
      .select("id, title, meeting_date, opportunity_id, summary, ai_summary, next_action_date, next_action_text, opportunities(name)")
      .gte("meeting_date", d45)
      .order("meeting_date", { ascending: false })
      .limit(120),
    sb
      .from("project_plans")
      .select("id, opportunity_id, status, priority, start_month, end_month, opportunities(name, accounts(name))")
      .limit(120),
    sb
      .from("project_weekly_reports")
      .select("plan_id, week_start, status, progress_pct, planned_mm, actual_mm, blockers")
      .order("week_start", { ascending: false })
      .limit(400),
    sb.from("sales_targets").select("target_month, target_amount"),
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
