/**
 * 稼働報告(週次実績記入→承認→原価連動)のデータ取得。
 * 記入者向けは my_work_context RPC(財務情報を含まない最小情報)、
 * 承認者向けは管理職RLSの直接クエリで取得する。
 *
 * 記入の単位は2種類:
 *  - 案件アサイン紐づき(assignment_id): 承認済み実績が案件の原価に反映される
 *  - 全般稼働(talent_idのみ): 稼働報告必須メンバーの、案件に紐づかない稼働
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
export interface MyTalent { talent_id: string; name: string; work_report_required: boolean }
export interface MyWorkContext { assignments: MyAssignment[]; talent: MyTalent | null }

export type WorkWeekStatus = "draft" | "submitted" | "approved" | "returned";
export interface WorkEntry {
  id: string;
  plan_id: string | null;
  assignment_id: string | null;
  talent_id: string | null;
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
  plan_id: string | null;
  assignment_id: string | null;
  talent_id: string | null;
  week_start: string;
  status: WorkWeekStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

/** 自分の記入コンテキスト(アサイン一覧+全般稼働の要否)。 */
export async function getMyWorkContext(): Promise<MyWorkContext> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("my_work_context");
  if (error) throw new Error(`アサイン情報の取得に失敗: ${error.message}`);
  const d = (data ?? {}) as { assignments?: MyAssignment[]; talent?: MyTalent | null };
  return { assignments: d.assignments ?? [], talent: d.talent ?? null };
}

/** 自分の指定週の記入行・週状態と、当月の実績合計。全般稼働(talentキー)も含む。 */
export async function getMyWorkWeek(
  assignmentIds: string[],
  talentId: string | null,
  weekStart: string,
  monthStart: string,
  monthEnd: string,
): Promise<{ entries: WorkEntry[]; weeks: WorkWeek[]; monthHours: Map<string, number>; generalMonthHours: number }> {
  const sb = getSupabaseServer();
  const empty = { data: [] as unknown[], error: null };
  const [entR, wkR, monR, gEntR, gWkR, gMonR] = await Promise.all([
    assignmentIds.length
      ? sb.from("work_entries").select("*").in("assignment_id", assignmentIds).eq("week_start", weekStart).order("work_date").order("created_at")
      : Promise.resolve(empty),
    assignmentIds.length
      ? sb.from("work_weeks").select("*").in("assignment_id", assignmentIds).eq("week_start", weekStart)
      : Promise.resolve(empty),
    assignmentIds.length
      ? sb.from("work_entries").select("assignment_id, hours").in("assignment_id", assignmentIds).gte("work_date", monthStart).lte("work_date", monthEnd)
      : Promise.resolve(empty),
    talentId
      ? sb.from("work_entries").select("*").eq("talent_id", talentId).is("assignment_id", null).eq("week_start", weekStart).order("work_date").order("created_at")
      : Promise.resolve(empty),
    talentId
      ? sb.from("work_weeks").select("*").eq("talent_id", talentId).is("assignment_id", null).eq("week_start", weekStart)
      : Promise.resolve(empty),
    talentId
      ? sb.from("work_entries").select("hours").eq("talent_id", talentId).is("assignment_id", null).gte("work_date", monthStart).lte("work_date", monthEnd)
      : Promise.resolve(empty),
  ]);
  for (const r of [entR, wkR, monR, gEntR, gWkR, gMonR]) {
    if ("error" in r && r.error) throw new Error(`稼働実績の取得に失敗: ${(r.error as { message: string }).message}`);
  }
  const monthHours = new Map<string, number>();
  for (const r of (monR.data ?? []) as { assignment_id: string; hours: number }[]) {
    monthHours.set(r.assignment_id, (monthHours.get(r.assignment_id) ?? 0) + (Number(r.hours) || 0));
  }
  const generalMonthHours = ((gMonR.data ?? []) as { hours: number }[]).reduce((s, r) => s + (Number(r.hours) || 0), 0);
  return {
    entries: [...((entR.data ?? []) as WorkEntry[]), ...((gEntR.data ?? []) as WorkEntry[])],
    weeks: [...((wkR.data ?? []) as WorkWeek[]), ...((gWkR.data ?? []) as WorkWeek[])],
    monthHours,
    generalMonthHours,
  };
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
export interface TalentLite { id: string; name: string; hourly_rate: number | null; employment_type: string }
export interface PendingWeek {
  week: WorkWeek;
  entries: WorkEntry[];
  totalHours: number;
  assignment: AssignmentInfo | null; // null = 全般稼働
  talent: TalentLite | null;
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
  const metas = await resolvePlanMeta(planIds);
  for (const [k, v] of metas) planMeta.set(k, v);
  return { assignments, planMeta };
}

/** 原価計画ID→案件名/取引先/月基準時間。 */
async function resolvePlanMeta(planIds: string[]): Promise<Map<string, { hoursPerMonth: number; oppName: string; accountName: string; opportunityId: string }>> {
  const sb = getSupabaseServer();
  const planMeta = new Map<string, { hoursPerMonth: number; oppName: string; accountName: string; opportunityId: string }>();
  if (planIds.length === 0) return planMeta;
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
  return planMeta;
}

async function fetchTalentsLite(talentIds: string[]): Promise<Map<string, TalentLite>> {
  if (talentIds.length === 0) return new Map();
  const sb = getSupabaseServer();
  const r = await sb.from("talents").select("id, name, hourly_rate, employment_type").in("id", talentIds);
  if (r.error) throw new Error(`タレントの取得に失敗: ${r.error.message}`);
  return new Map(((r.data ?? []) as TalentLite[]).map((t) => [t.id, t]));
}

/** 提出済み(承認待ち)の週を、記入行・案件情報つきで取得(全般稼働含む)。 */
export async function getPendingWorkWeeks(): Promise<PendingWeek[]> {
  const sb = getSupabaseServer();
  const wkR = await sb.from("work_weeks").select("*").eq("status", "submitted").order("submitted_at", { ascending: true }).limit(100);
  if (wkR.error) throw new Error(`承認待ち週の取得に失敗: ${wkR.error.message}`);
  const weeks = (wkR.data ?? []) as WorkWeek[];
  if (weeks.length === 0) return [];

  const assignmentIds = [...new Set(weeks.map((w) => w.assignment_id).filter((v): v is string => !!v))];
  const talentIds = [...new Set(weeks.filter((w) => !w.assignment_id).map((w) => w.talent_id).filter((v): v is string => !!v))];
  const weekStarts = [...new Set(weeks.map((w) => w.week_start))];
  const [entR, ctxR, talents] = await Promise.all([
    sb.from("work_entries").select("*").in("week_start", weekStarts),
    resolveAssignmentContext(assignmentIds),
    fetchTalentsLite(talentIds),
  ]);
  if (entR.error) throw new Error(`記入行の取得に失敗: ${entR.error.message}`);
  const entries = ((entR.data ?? []) as WorkEntry[]).sort((a, b) => a.work_date.localeCompare(b.work_date));

  return weeks.flatMap((w) => {
    const isGeneral = !w.assignment_id;
    const a = w.assignment_id ? ctxR.assignments.get(w.assignment_id) ?? null : null;
    if (!isGeneral && !a) return [];
    const t = isGeneral && w.talent_id ? talents.get(w.talent_id) ?? null : null;
    const meta = a ? ctxR.planMeta.get(a.plan_id) : undefined;
    const es = entries.filter((e) =>
      e.week_start === w.week_start &&
      (isGeneral ? !e.assignment_id && e.talent_id === w.talent_id : e.assignment_id === w.assignment_id),
    );
    return [{
      week: w,
      entries: es,
      totalHours: es.reduce((s, e) => s + (Number(e.hours) || 0), 0),
      assignment: a,
      talent: t,
      hoursPerMonth: meta?.hoursPerMonth ?? 160,
      oppName: meta?.oppName ?? "",
      accountName: meta?.accountName ?? "",
      opportunityId: meta?.opportunityId ?? "",
    }];
  });
}

export interface MonthlyWorkRow {
  key: string;
  label: string;
  kind: string; // external/internal/general
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

/** 月次サマリー(承認済み工数と予定工数。請求参考額の計算材料)。全般稼働は時給換算。 */
export async function getMonthlyWorkSummary(monthStart: string, monthEnd: string): Promise<MonthlyWorkRow[]> {
  const sb = getSupabaseServer();
  const [entR, wkR, cmR] = await Promise.all([
    sb.from("work_entries").select("assignment_id, talent_id, week_start, hours").gte("work_date", monthStart).lte("work_date", monthEnd),
    sb.from("work_weeks").select("assignment_id, talent_id, week_start, status").in("status", ["approved", "submitted"]),
    sb.from("project_cost_months").select("assignment_id, man_month, ratio, hours").eq("month", monthStart),
  ]);
  if (entR.error) throw new Error(`稼働実績の取得に失敗: ${entR.error.message}`);
  if (wkR.error) throw new Error(`週状態の取得に失敗: ${wkR.error.message}`);
  if (cmR.error) throw new Error(`予定工数の取得に失敗: ${cmR.error.message}`);

  const unitKey = (assignmentId: string | null, talentId: string | null) => (assignmentId ? `a:${assignmentId}` : `t:${talentId}`);
  const weekStatus = new Map<string, string>();
  for (const w of (wkR.data ?? []) as { assignment_id: string | null; talent_id: string | null; week_start: string; status: string }[]) {
    weekStatus.set(`${unitKey(w.assignment_id, w.talent_id)}|${w.week_start}`, w.status);
  }
  const approved = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const e of (entR.data ?? []) as { assignment_id: string | null; talent_id: string | null; week_start: string; hours: number }[]) {
    const k = unitKey(e.assignment_id, e.talent_id);
    const st = weekStatus.get(`${k}|${e.week_start}`);
    if (st === "approved") approved.set(k, (approved.get(k) ?? 0) + (Number(e.hours) || 0));
    else if (st === "submitted") pending.set(k, (pending.get(k) ?? 0) + (Number(e.hours) || 0));
  }

  const cms = (cmR.data ?? []) as { assignment_id: string; man_month: number; ratio: number | null; hours: number | null }[];
  const keys = [...new Set([...approved.keys(), ...pending.keys(), ...cms.map((c) => `a:${c.assignment_id}`)])];
  if (keys.length === 0) return [];
  const assignmentIds = keys.filter((k) => k.startsWith("a:")).map((k) => k.slice(2));
  const talentIds = keys.filter((k) => k.startsWith("t:")).map((k) => k.slice(2));
  const [{ assignments, planMeta }, talents] = await Promise.all([
    resolveAssignmentContext(assignmentIds),
    fetchTalentsLite(talentIds),
  ]);

  const rows: MonthlyWorkRow[] = [];
  for (const k of keys) {
    if (k.startsWith("a:")) {
      const a = assignments.get(k.slice(2));
      if (!a) continue;
      const meta = planMeta.get(a.plan_id);
      const H = meta?.hoursPerMonth ?? 160;
      const plannedHours = cms
        .filter((c) => c.assignment_id === a.id)
        .reduce((s, c) => s + (c.hours != null ? Number(c.hours) : Math.round((Number(c.man_month) || 0) * Number(c.ratio ?? 1) * H)), 0);
      rows.push({
        key: k, label: a.label, kind: a.kind, role: a.role,
        oppName: meta?.oppName ?? "—", accountName: meta?.accountName ?? "—",
        plannedHours, approvedHours: approved.get(k) ?? 0, pendingHours: pending.get(k) ?? 0,
        costRate: Number(a.cost_rate) || 0, rateUnit: a.rate_unit ?? "man_month", hoursPerMonth: H,
      });
    } else {
      const t = talents.get(k.slice(2));
      if (!t) continue;
      rows.push({
        key: k, label: t.name, kind: "general", role: null,
        oppName: "全般稼働（案件紐づけなし）", accountName: "",
        plannedHours: 0, approvedHours: approved.get(k) ?? 0, pendingHours: pending.get(k) ?? 0,
        costRate: Number(t.hourly_rate) || 0, rateUnit: "hourly", hoursPerMonth: 160,
      });
    }
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  return rows;
}

/** 原価管理連動用: 承認済み実績工数を plan×月 / assignment×月 で集計(案件紐づき分のみ)。 */
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
    ((wkR.data ?? []) as { assignment_id: string | null; week_start: string }[])
      .filter((w) => w.assignment_id)
      .map((w) => `${w.assignment_id}|${w.week_start}`),
  );
  for (const e of (entR.data ?? []) as { plan_id: string | null; assignment_id: string | null; week_start: string; work_date: string; hours: number }[]) {
    if (!e.plan_id || !e.assignment_id) continue;
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

// ---- 稼働報告メンバー設定(承認画面) ----

export interface WorkReporter {
  talent: TalentLite & { user_id: string | null; work_report_required: boolean; role_text: string | null };
  links: { assignmentId: string; planId: string; oppName: string; accountName: string; opportunityId: string }[];
}
export interface PlanOption { planId: string; label: string }

/** 稼働報告必須メンバーの一覧と、その案件紐づけ(アサイン)状況+紐づけ先候補。 */
export async function getWorkReporters(): Promise<{ reporters: WorkReporter[]; planOptions: PlanOption[] }> {
  const sb = getSupabaseServer();
  const talR = await sb
    .from("talents")
    .select("id, name, hourly_rate, employment_type, user_id, work_report_required, role_text")
    .eq("work_report_required", true)
    .order("name");
  if (talR.error) throw new Error(`稼働報告メンバーの取得に失敗: ${talR.error.message}`);
  const reporters = (talR.data ?? []) as WorkReporter["talent"][];

  const [asgR, plansR] = await Promise.all([
    reporters.length
      ? sb.from("project_assignments").select("id, plan_id, talent_id").eq("status", "active").in("talent_id", reporters.map((t) => t.id))
      : Promise.resolve({ data: [], error: null }),
    sb.from("project_plans").select("id"),
  ]);
  if (asgR.error) throw new Error(`アサインの取得に失敗: ${asgR.error.message}`);
  if (plansR.error) throw new Error(`原価計画の取得に失敗: ${plansR.error.message}`);
  const asgs = (asgR.data ?? []) as { id: string; plan_id: string; talent_id: string | null }[];
  const allPlanIds = ((plansR.data ?? []) as { id: string }[]).map((p) => p.id);
  const metas = await resolvePlanMeta([...new Set([...allPlanIds, ...asgs.map((a) => a.plan_id)])]);

  const planOptions: PlanOption[] = allPlanIds
    .map((id) => ({ planId: id, label: `${metas.get(id)?.accountName ?? "—"}｜${metas.get(id)?.oppName ?? "—"}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));

  return {
    reporters: reporters.map((t) => ({
      talent: t,
      links: asgs
        .filter((a) => a.talent_id === t.id)
        .map((a) => ({
          assignmentId: a.id,
          planId: a.plan_id,
          oppName: metas.get(a.plan_id)?.oppName ?? "—",
          accountName: metas.get(a.plan_id)?.accountName ?? "—",
          opportunityId: metas.get(a.plan_id)?.opportunityId ?? "",
        })),
    })),
    planOptions,
  };
}
