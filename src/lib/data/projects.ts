/** 案件管理(デリバリー原価・粗利管理)のデータ取得と集計。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  rollup,
  discountRoom,
  proposalVerdict,
  DEFAULT_THRESHOLDS,
  type Assignment as CalcAssignment,
  type RevenueCell,
  type Rollup,
  type Verdict,
  type DiscountRoom,
  type RiskLevel,
  type Involvement,
} from "@/lib/project-cost";

export interface ProjectPlan {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  account_id: string | null;
  start_month: string | null;
  end_month: string | null;
  min_gross_rate: number;
  hq_involvement: Involvement;
  plan_risk: RiskLevel;
  status: string;
  baseline_locked_at: string | null;
  notes: string | null;
  hours_per_month: number;
}
export interface RevenueMonth { id: string; plan_id: string; month: string; amount: number; note: string | null; }
export interface ProjAssignment {
  id: string; plan_id: string; kind: string; talent_id: string | null; member_user_id: string | null;
  label: string; role: string | null; cost_rate: number; bill_rate: number | null;
  rate_unit: "man_month" | "hourly"; effort_unit: "ratio" | "hours";
  start_month: string | null; end_month: string | null; status: string; notes: string | null;
}
export interface CostMonth { id: string; plan_id: string; assignment_id: string; month: string; man_month: number; ratio: number; hours: number | null; cost_amount: number; }
export interface WeeklyReport {
  id: string; plan_id: string; assignment_id: string | null;
  period_type: "weekly" | "monthly" | "final"; week_start: string | null; period_month: string | null;
  planned_mm: number | null; actual_mm: number | null; planned_cost: number | null; actual_cost: number | null;
  progress_pct: number | null; status: string; reporter: string | null; blockers: string | null; notes: string | null;
}

export interface ProjectBundle {
  plan: ProjectPlan;
  revenues: RevenueMonth[];
  assignments: ProjAssignment[];
  costMonths: CostMonth[];
  weekly: WeeklyReport[];
}

export interface ProjectComputed {
  roll: Rollup;
  verdict: Verdict;
  room: DiscountRoom;
}

/** DBの月(YYYY-MM-01)を計算キー(YYYY-MM)へ。 */
export const monthKey = (d: string | null): string => (d ? d.slice(0, 7) : "");

/** 開始〜終了月(YYYY-MM)の配列。最大36ヶ月で打ち切り(暴走防止)。 */
export function monthRange(startMonth: string | null, endMonth: string | null): string[] {
  const s = monthKey(startMonth), e = monthKey(endMonth);
  if (!s || !e || s > e) return s ? [s] : [];
  const out: string[] = [];
  const [sy, sm] = s.split("-").map(Number);
  let y = sy, m = sm, guard = 0;
  while (guard++ < 36) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key === e) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** 案件(opportunity)の案件管理バンドルを取得。計画がなければ null。 */
export async function getProjectBundle(opportunityId: string): Promise<ProjectBundle | null> {
  const sb = getSupabaseServer();
  const { data: plan } = await sb.from("project_plans").select("*").eq("opportunity_id", opportunityId).maybeSingle();
  if (!plan) return null;
  const planId = (plan as ProjectPlan).id;
  const [rev, asg, cm, wk] = await Promise.all([
    sb.from("project_revenue_months").select("*").eq("plan_id", planId).order("month"),
    sb.from("project_assignments").select("*").eq("plan_id", planId).order("created_at"),
    sb.from("project_cost_months").select("*").eq("plan_id", planId),
    sb.from("project_weekly_reports").select("*").eq("plan_id", planId).order("created_at", { ascending: false }),
  ]);
  return {
    plan: plan as ProjectPlan,
    revenues: (rev.data ?? []) as RevenueMonth[],
    assignments: (asg.data ?? []) as ProjAssignment[],
    costMonths: (cm.data ?? []) as CostMonth[],
    weekly: (wk.data ?? []) as WeeklyReport[],
  };
}

/** バンドルを純計算ロジックに渡し、月別集計・提案可否・値引き余地を求める。 */
export function computeProject(bundle: ProjectBundle): ProjectComputed {
  const H = Number(bundle.plan.hours_per_month) || 160;
  const assignments: CalcAssignment[] = bundle.assignments
    .filter((a) => a.status !== "removed")
    .map((a) => ({
      id: a.id,
      label: a.label,
      costRate: Number(a.cost_rate) || 0,
      rateUnit: a.rate_unit ?? "man_month",
      effortUnit: a.effort_unit ?? "ratio",
      hoursPerMonth: H,
      cells: bundle.costMonths
        .filter((c) => c.assignment_id === a.id)
        .map((c) => ({ month: monthKey(c.month), manMonth: Number(c.man_month) || 0, ratio: Number(c.ratio ?? 1), hours: c.hours == null ? undefined : Number(c.hours) })),
    }));
  const revenue: RevenueCell[] = bundle.revenues.map((r) => ({ month: monthKey(r.month), amount: Number(r.amount) || 0 }));
  const roll = rollup(assignments, revenue);
  const verdict = proposalVerdict({
    grossRate: roll.totals.grossRate,
    risk: bundle.plan.plan_risk,
    involvement: bundle.plan.hq_involvement,
    thresholds: DEFAULT_THRESHOLDS,
  });
  const room = discountRoom(roll.totals.revenue, roll.totals.cost, Number(bundle.plan.min_gross_rate) || 0.25);
  return { roll, verdict, room };
}

export interface ManagedProjectRow {
  opportunityId: string;
  oppName: string;
  accountName: string;
  ownerUserId: string | null;
  status: string;
  plan: ProjectPlan | null;
  computed: ProjectComputed | null;
}

/** 案件管理対象(フラグON)の案件を、月別集計サマリ付きで一覧取得。 */
export async function listManagedProjects(): Promise<ManagedProjectRow[]> {
  const sb = getSupabaseServer();
  const { data: opps } = await sb
    .from("opportunities")
    .select("id, name, account_id, owner_user_id, status")
    .eq("is_project_managed", true);
  const oppRows = (opps ?? []) as { id: string; name: string; account_id: string | null; owner_user_id: string | null; status: string }[];
  if (oppRows.length === 0) return [];

  const oppIds = oppRows.map((o) => o.id);
  const accIds = [...new Set(oppRows.map((o) => o.account_id).filter((v): v is string => !!v))];
  const [plansR, accR] = await Promise.all([
    sb.from("project_plans").select("*").in("opportunity_id", oppIds),
    accIds.length ? sb.from("accounts").select("id, name").in("id", accIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const plans = (plansR.data ?? []) as ProjectPlan[];
  const accName = new Map((((accR.data ?? []) as { id: string; name: string }[])).map((a) => [a.id, a.name]));
  const planByOpp = new Map(plans.map((p) => [p.opportunity_id, p]));

  const planIds = plans.map((p) => p.id);
  const [revR, cmR, asgR] = planIds.length
    ? await Promise.all([
        sb.from("project_revenue_months").select("*").in("plan_id", planIds),
        sb.from("project_cost_months").select("*").in("plan_id", planIds),
        sb.from("project_assignments").select("*").in("plan_id", planIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const revs = (revR.data ?? []) as RevenueMonth[];
  const cms = (cmR.data ?? []) as CostMonth[];
  const asgs = (asgR.data ?? []) as ProjAssignment[];

  const byPlan = <T extends { plan_id: string }>(arr: T[], id: string) => arr.filter((x) => x.plan_id === id);

  return oppRows.map((o): ManagedProjectRow => {
    const plan = planByOpp.get(o.id) ?? null;
    let computed: ProjectComputed | null = null;
    if (plan) {
      computed = computeProject({
        plan,
        revenues: byPlan(revs, plan.id),
        assignments: byPlan(asgs, plan.id),
        costMonths: byPlan(cms, plan.id),
        weekly: [],
      });
    }
    return {
      opportunityId: o.id,
      oppName: o.name,
      accountName: o.account_id ? accName.get(o.account_id) ?? "—" : "—",
      ownerUserId: o.owner_user_id,
      status: o.status,
      plan,
      computed,
    };
  });
}
