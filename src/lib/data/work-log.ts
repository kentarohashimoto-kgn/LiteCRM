/**
 * 稼働報告(週次実績記入→承認→原価連動)のデータ取得。
 * 記入者向けは my_work_context RPC(財務情報を含まない最小情報)、
 * 承認者向けは管理職RLSの直接クエリで取得する。
 */
import { getSupabaseServer } from "@/lib/supabase/server";

export interface PlannedMonth { month: string; hours: number } // month: YYYY-MM
export interface MyAssignment {
  assignment_id: string;
  plan_id: string;
  label: string;
  role: string | null;
  opp_name: string;
  account_name: string;
  hours_per_month: number;
  start_month: string | null;
  end_month: string | null;
  planned_months: PlannedMonth[];
}
export type WorkWeekStatus = "draft" | "submitted" | "approved" | "returned";
export interface WorkEntry {
  id: string;
  plan_id: string;
  assignment_id: string;
  work_date: string;
  week_start: string;
  hours: number;
  task_text: string | null;
  outcome_text: string | null;
  next_action_text: string | null;
  risk_text: string | null;
  memo: string | null;
}
export interface WorkWeek {
  id: string;
  plan_id: string;
  assignment_id: string;
  week_start: string;
  status: WorkWeekStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

/** 自分のアサイン一覧(記入対象)。 */
export async function getMyAssignments(): Promise<MyAssignment[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("my_work_context");
  if (error) throw new Error(`アサイン情報の取得に失敗: ${error.message}`);
  return (data ?? []) as MyAssignment[];
}

/** 自分の指定週の記入行・週状態と、当月の実績合計(アサイン別)。 */
export async function getMyWorkWeek(
  assignmentIds: string[],
  weekStart: string,
  monthStart: string,
  monthEnd: string,
): Promise<{ entries: WorkEntry[]; weeks: WorkWeek[]; monthHours: Map<string, number> }> {
  if (assignmentIds.length === 0) return { entries: [], weeks: [], monthHours: new Map() };
  const sb = getSupabaseServer();
  const [entR, wkR, monR] = await Promise.all([
    sb.from("work_entries").select("*").in("assignment_id", assignmentIds).eq("week_start", weekStart).order("work_date").order("created_at"),
    sb.from("work_weeks").select("*").in("assignment_id", assignmentIds).eq("week_start", weekStart),
    sb.from("work_entries").select("assignment_id, hours").in("assignment_id", assignmentIds).gte("work_date", monthStart).lte("work_date", monthEnd),
  ]);
  if (entR.error) throw new Error(`稼働実績の取得に失敗: ${entR.error.message}`);
  if (wkR.error) throw new Error(`週の状態の取得に失敗: ${wkR.error.message}`);
  if (monR.error) throw new Error(`月間実績の取得に失敗: ${monR.error.message}`);
  const monthHours = new Map<string, number>();
  for (const r of (monR.data ?? []) as { assignment_id: string; hours: number }[]) {
    monthHours.set(r.assignment_id, (monthHours.get(r.assignment_id) ?? 0) + (Number(r.hours) || 0));
  }
  return { entries: (entR.data ?? []) as WorkEntry[], weeks: (wkR.data ?? []) as WorkWeek[], monthHours };
}

// ---- 承認者向け ----

export interface AssignmentInfo {
  id: string;
  plan_id: string;
  kind: string;
  label: string;
  role: string | null;
  cost_rate: number;
  rate_unit: "man_month" | "hourly";
}
export interface PendingWeek {
  week: WorkWeek;
  entries: WorkEntry[];
  totalHours: number;
  assignment: AssignmentInfo;
  hoursPerMonth: number;
  oppName: string;
  accountName: string;
  opportunityId: string;
}

/** アサイン→案件名/取引先/基準時間の解決(承認・集計画面共用)。 */
async function resolveAssignmentContext(assignmentIds: string[]): Promise<{
  assignments: Map<string, AssignmentInfo>;
  planMeta: Map<string, { hoursPerMonth: number; oppName: string; accountName: string; opportunityId: string }>;
}> {
  const sb = getSupabaseServer();
  const assignments = new Map<string, AssignmentInfo>();
  const planMeta = new Map<string, { hoursPerMonth: number; oppName: string; accountName: string; opportunityId: string }>();
  if (assignmentIds.length === 0) return { assignments, planMeta };

  const asgR = await sb.from("project_assignments").select("id, plan_id, kind, label, role, cost_rate, rate_unit").in("id", assignmentIds);
  if (asgR.error) throw new Error(`アサインの取得に失敗: ${asgR.error.message}`);
  const asgs = (asgR.data ?? []) as AssignmentInfo[];
  for (const a of asgs) assignments.set(a.id, a);

  const planIds = [...new Set(asgs.map((a) => a.plan_id))];
  if (planIds.length === 0) return { assignments, planMeta };
  const planR = await sb.from("project_plans").select("id, opportunity_id, account_id, hours_per_month").in("id", planIds);
  if (planR.error) throw new Error(`原価計画の取得に失敗: ${planR.error.message}`);
  const plans = (planR.data ?? []) as { id: string; opportunity_id: string; account_id: string | null; hours_per_month: number }[];

  const oppIds = [...new Set(plans.map((p) => p.opportunity_id))];
  const accIds = [...new Set(plans.map((p) => p.account_id).filter((v): v is string => !!v))];
  const [oppR, accR] = await Promise.all([
    oppIds.length ? sb.from("opportunities").select("id, name").in("id", oppIds) : Promise.resolve({ data: [], error: null }),
    accIds.length ? sb.from("accounts").select("id, name").in("id", accIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (oppR.error) throw new Error(`案件の取得に失敗: ${oppR.error.message}`);
  if (accR.error) throw new Error(`取引先の取得に失敗: ${accR.error.message}`);
  const oppName = new Map(((oppR.data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const accName = new Map(((accR.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));

  for (const p of plans) {
    planMeta.set(p.id, {
      hoursPerMonth: Number(p.hours_per_month) || 160,
      oppName: oppName.get(p.opportunity_id) ?? "—",
      accountName: p.account_id ? accName.get(p.account_id) ?? "—" : "—",
      opportunityId: p.opportunity_id,
    });
  }
  return { assignments, planMeta };
}

/** 提出済み(承認待ち)の週を、記入行・案件情報つきで取得。 */
export async function getPendingWorkWeeks(): Promise<PendingWeek[]> {
  const sb = getSupabaseServer();
  const wkR = await sb.from("work_weeks").select("*").eq("status", "submitted").order("submitted_at", { ascending: true }).limit(100);
  if (wkR.error) throw new Error(`承認待ち週の取得に失敗: ${wkR.error.message}`);
  const weeks = (wkR.data ?? []) as WorkWeek[];
  if (weeks.length === 0) return [];

  const assignmentIds = [...new Set(weeks.map((w) => w.assignment_id))];
  const weekStarts = [...new Set(weeks.map((w) => w.week_start))];
  const [entR, ctxR] = await Promise.all([
    sb.from("work_entries").select("*").in("assignment_id", assignmentIds).in("week_start", weekStarts).order("work_date"),
    resolveAssignmentContext(assignmentIds),
  ]);
  if (entR.error) throw new Error(`記入行の取得に失敗: ${entR.error.message}`);
  const entries = (entR.data ?? []) as WorkEntry[];

  return weeks.flatMap((w) => {
    const a = ctxR.assignments.get(w.assignment_id);
    if (!a) return [];
    const meta = ctxR.planMeta.get(a.plan_id);
    const es = entries.filter((e) => e.assignment_id === w.assignment_id && e.week_start === w.week_start);
    return [{
      week: w,
      entries: es,
      totalHours: es.reduce((s, e) => s + (Number(e.hours) || 0), 0),
      assignment: a,
      hoursPerMonth: meta?.hoursPerMonth ?? 160,
      oppName: meta?.oppName ?? "—",
      accountName: meta?.accountName ?? "—",
      opportunityId: meta?.opportunityId ?? "",
    }];
  });
}

export interface MonthlyWorkRow {
  assignmentId: string;
  label: string;
  kind: string;
  role: string | null;
  oppName: string;
  accountName: string;
  plannedHours: number;
  approvedHours: number;
  pendingHours: number; // 提出済み(未承認)
  costRate: number;
  rateUnit: "man_month" | "hourly";
  hoursPerMonth: number;
}

/** 月次サマリー(承認済み工数と予定工数。請求参考額の計算材料)。month: YYYY-MM-01 */
export async function getMonthlyWorkSummary(monthStart: string, monthEnd: string): Promise<MonthlyWorkRow[]> {
  const sb = getSupabaseServer();
  const [entR, wkR, cmR] = await Promise.all([
    sb.from("work_entries").select("assignment_id, week_start, hours").gte("work_date", monthStart).lte("work_date", monthEnd),
    sb.from("work_weeks").select("assignment_id, week_start, status").in("status", ["approved", "submitted"]),
    sb.from("project_cost_months").select("assignment_id, man_month, ratio, hours").eq("month", monthStart),
  ]);
  if (entR.error) throw new Error(`稼働実績の取得に失敗: ${entR.error.message}`);
  if (wkR.error) throw new Error(`週状態の取得に失敗: ${wkR.error.message}`);
  if (cmR.error) throw new Error(`予定工数の取得に失敗: ${cmR.error.message}`);

  const weekStatus = new Map<string, string>();
  for (const w of (wkR.data ?? []) as { assignment_id: string; week_start: string; status: string }[]) {
    weekStatus.set(`${w.assignment_id}|${w.week_start}`, w.status);
  }
  const approved = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const e of (entR.data ?? []) as { assignment_id: string; week_start: string; hours: number }[]) {
    const st = weekStatus.get(`${e.assignment_id}|${e.week_start}`);
    if (st === "approved") approved.set(e.assignment_id, (approved.get(e.assignment_id) ?? 0) + (Number(e.hours) || 0));
    else if (st === "submitted") pending.set(e.assignment_id, (pending.get(e.assignment_id) ?? 0) + (Number(e.hours) || 0));
  }

  const assignmentIds = [...new Set([
    ...approved.keys(),
    ...pending.keys(),
    ...((cmR.data ?? []) as { assignment_id: string }[]).map((c) => c.assignment_id),
  ])];
  if (assignmentIds.length === 0) return [];
  const { assignments, planMeta } = await resolveAssignmentContext(assignmentIds);

  const rows: MonthlyWorkRow[] = [];
  for (const id of assignmentIds) {
    const a = assignments.get(id);
    if (!a) continue;
    const meta = planMeta.get(a.plan_id);
    const H = meta?.hoursPerMonth ?? 160;
    const cm = ((cmR.data ?? []) as { assignment_id: string; man_month: number; ratio: number | null; hours: number | null }[])
      .filter((c) => c.assignment_id === id)
      .reduce((s, c) => s + (c.hours != null ? Number(c.hours) : Math.round((Number(c.man_month) || 0) * (Number(c.ratio ?? 1)) * H)), 0);
    rows.push({
      assignmentId: id,
      label: a.label,
      kind: a.kind,
      role: a.role,
      oppName: meta?.oppName ?? "—",
      accountName: meta?.accountName ?? "—",
      plannedHours: cm,
      approvedHours: approved.get(id) ?? 0,
      pendingHours: pending.get(id) ?? 0,
      costRate: Number(a.cost_rate) || 0,
      rateUnit: a.rate_unit ?? "man_month",
      hoursPerMonth: H,
    });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  return rows;
}

/** 原価管理連動用: 承認済み実績工数を plan×月 / assignment×月 で集計。 */
export async function getApprovedWorkByPlan(planIds: string[]): Promise<{
  byPlanMonth: Map<string, Map<string, number>>; // plan_id -> (YYYY-MM -> hours)
  byAssignmentMonth: Map<string, Map<string, number>>; // assignment_id -> (YYYY-MM -> hours)
}> {
  const byPlanMonth = new Map<string, Map<string, number>>();
  const byAssignmentMonth = new Map<string, Map<string, number>>();
  if (planIds.length === 0) return { byPlanMonth, byAssignmentMonth };
  const sb = getSupabaseServer();
  const [wkR, entR] = await Promise.all([
    sb.from("work_weeks").select("assignment_id, week_start").eq("status", "approved").in("plan_id", planIds),
    sb.from("work_entries").select("plan_id, assignment_id, week_start, work_date, hours").in("plan_id", planIds),
  ]);
  if (wkR.error) throw new Error(`承認済み週の取得に失敗: ${wkR.error.message}`);
  if (entR.error) throw new Error(`稼働実績の取得に失敗: ${entR.error.message}`);
  const approvedKeys = new Set(
    ((wkR.data ?? []) as { assignment_id: string; week_start: string }[]).map((w) => `${w.assignment_id}|${w.week_start}`),
  );
  for (const e of (entR.data ?? []) as { plan_id: string; assignment_id: string; week_start: string; work_date: string; hours: number }[]) {
    if (!approvedKeys.has(`${e.assignment_id}|${e.week_start}`)) continue;
    const month = e.work_date.slice(0, 7);
    const h = Number(e.hours) || 0;
    const pm = byPlanMonth.get(e.plan_id) ?? new Map<string, number>();
    pm.set(month, (pm.get(month) ?? 0) + h);
    byPlanMonth.set(e.plan_id, pm);
    const am = byAssignmentMonth.get(e.assignment_id) ?? new Map<string, number>();
    am.set(month, (am.get(month) ?? 0) + h);
    byAssignmentMonth.set(e.assignment_id, am);
  }
  return { byPlanMonth, byAssignmentMonth };
}
