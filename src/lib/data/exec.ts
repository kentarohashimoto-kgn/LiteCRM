/**
 * 経営レビュー(週次幹部MTG支援)のデータアクセス。
 * 実績は既存DB(leads / opportunities)から参照集計し、目標・振り返り・アクションは新規テーブルから取得する。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { judgeKpi, buildSystemComment, SALES_KPIS, type Evaluation, type KpiJudge } from "@/lib/exec-review";
import type { WeeklyKpiTarget, WeeklyKpiResult, WeeklyReview, MtgAction } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
function ymd(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** 対象月(YYYY-MM-01)の週数(7日区切り)。 */
export function weeksInMonth(month: string): number {
  const d = new Date(month);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.ceil(days / 7);
}
/** target_month + target_week(1..5) → 日付範囲(7日区切り)。week=0は月全体。 */
export function weekRange(month: string, week: number): { start: string; end: string; monthStart: string; monthEnd: string } {
  const d = new Date(month);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const monthStart = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const monthEnd = ymd(new Date(d.getFullYear(), d.getMonth(), lastDay));
  if (week <= 0) return { start: monthStart, end: monthEnd, monthStart, monthEnd };
  const sDay = (week - 1) * 7 + 1;
  const eDay = Math.min(week * 7, lastDay);
  return {
    start: ymd(new Date(d.getFullYear(), d.getMonth(), sDay)),
    end: ymd(new Date(d.getFullYear(), d.getMonth(), eDay)),
    monthStart, monthEnd,
  };
}

/** 当月・現在週(7日区切り)。 */
export function currentPeriod(): { month: string; week: number } {
  const d = new Date();
  const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  return { month, week: Math.min(weeksInMonth(month), Math.ceil(d.getDate() / 7)) };
}
/** searchParams から対象月・対象週を解決。 */
export function parsePeriod(sp: { month?: string; week?: string }): { month: string; week: number } {
  const cur = currentPeriod();
  const month = sp.month ? sp.month.slice(0, 7) + "-01" : cur.month;
  const week = sp.week != null ? Math.max(1, Math.min(weeksInMonth(month), parseInt(sp.week, 10) || cur.week)) : cur.week;
  return { month, week };
}

/** 既存DBから営業KPIの実績を集計(参照のみ)。 */
export async function getSalesActual(kpiType: string, start: string, end: string): Promise<number> {
  const sb = getSupabaseServer();
  if (kpiType === "lead") {
    const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).gte("acquired_at", start).lte("acquired_at", end);
    return count ?? 0;
  }
  if (kpiType === "appointment") {
    const { count } = await sb.from("opportunities").select("id", { count: "exact", head: true }).not("first_meeting_date", "is", null).gte("first_meeting_date", start).lte("first_meeting_date", end);
    return count ?? 0;
  }
  const { data } = await sb.from("opportunities").select("amount,gross_profit").eq("status", "won").gte("expected_close_date", start).lte("expected_close_date", end);
  const rows = (data ?? []) as { amount: number | null; gross_profit: number | null }[];
  if (kpiType === "deal") return rows.length;
  if (kpiType === "revenue") return rows.reduce((s, o) => s + (o.amount ?? 0), 0);
  if (kpiType === "gross_profit") return rows.reduce((s, o) => s + (o.gross_profit ?? 0), 0);
  return 0;
}

export interface KpiReviewRow {
  kpiType: string;
  target?: WeeklyKpiTarget;
  result?: WeeklyKpiResult;
  review?: WeeklyReview;
  monthlyTarget: number;
  weeklyTarget: number;
  actual: number;
  actualSource: "auto" | "manual";
  monthlyActual: number;
  remainingWeeks: number;
  judge: KpiJudge;
  systemComment: string;
}

/** 対象月・対象週の営業KPI振り返り(予実・判定・考察)を構築。 */
export async function getKpiReview(month: string, week: number): Promise<KpiReviewRow[]> {
  const sb = getSupabaseServer();
  const range = weekRange(month, week);
  const remainingWeeks = Math.max(0, weeksInMonth(month) - week);

  const [{ data: tData }, { data: rData }, { data: revData }] = await Promise.all([
    sb.from("weekly_kpi_targets").select("*").eq("target_month", month).eq("target_week", week).eq("department", "sales"),
    sb.from("weekly_kpi_results").select("*"),
    sb.from("weekly_reviews").select("*"),
  ]);
  const targets = (tData ?? []) as WeeklyKpiTarget[];
  const resultByTarget = new Map((rData ?? []).map((r) => [(r as WeeklyKpiResult).target_id, r as WeeklyKpiResult]));
  const reviewByTarget = new Map((revData ?? []).map((r) => [(r as WeeklyReview).target_id, r as WeeklyReview]));

  // 全KPIの週次・月間実績を一括で並列取得(逐次round-tripを排除)
  const actualPairs = await Promise.all(
    SALES_KPIS.map(async (kpi) => {
      const [autoActual, monthlyActual] = await Promise.all([
        getSalesActual(kpi.key, range.start, range.end),
        getSalesActual(kpi.key, range.monthStart, range.end),
      ]);
      return [kpi.key, { autoActual, monthlyActual }] as const;
    }),
  );
  const actualByKpi = new Map(actualPairs);

  return SALES_KPIS.map((kpi) => {
    const target = targets.find((t) => t.kpi_type === kpi.key);
    const result = target ? resultByTarget.get(target.id) : undefined;
    const review = target ? reviewByTarget.get(target.id) : undefined;
    const monthlyTarget = target?.monthly_target ?? 0;
    const weeklyTarget = target?.weekly_target ?? 0;
    const a = actualByKpi.get(kpi.key)!;
    const actual = result?.actual_source === "manual" ? result.actual_value : a.autoActual;
    const calc = { monthlyTarget, weeklyTarget, actual, monthlyActual: a.monthlyActual, remainingWeeks };
    const judge = judgeKpi(calc);
    return {
      kpiType: kpi.key, target, result, review, monthlyTarget, weeklyTarget, actual,
      actualSource: result?.actual_source ?? "auto", monthlyActual: a.monthlyActual, remainingWeeks, judge,
      systemComment: buildSystemComment(kpi.key, calc, judge),
    };
  });
}

/** MTGアクション一覧。 */
export async function listMtgActions(): Promise<MtgAction[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("mtg_actions").select("*").order("due_date", { ascending: true, nullsFirst: false });
  return (data ?? []) as MtgAction[];
}

/** 振り返り履歴(新しい順)。 */
export async function listWeeklyReviews(): Promise<WeeklyReview[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("weekly_reviews").select("*").order("updated_at", { ascending: false });
  return (data ?? []) as WeeklyReview[];
}

/** 営業の重要アラート(評価Bad数・期限超過/未完了アクション)。 */
export async function getExecAlerts(reviewRows: KpiReviewRow[], actions: MtgAction[]): Promise<{ bad: number; watch: number; overdue: MtgAction[]; openActions: number }> {
  const todayStr = ymd(new Date());
  const bad = reviewRows.filter((r) => r.judge.evaluation === "bad").length;
  const watch = reviewRows.filter((r) => r.judge.evaluation === "watch").length;
  const open = actions.filter((a) => a.status !== "done");
  const overdue = open.filter((a) => a.due_date && a.due_date < todayStr);
  return { bad, watch, overdue, openActions: open.length };
}

/** 既存商談のA/B/C読み(yomi)管理データ。 */
export async function getDealReads(): Promise<{ rows: DealReadRow[]; summary: Record<string, { count: number; amount: number }> }> {
  const sb = getSupabaseServer();
  const [{ data: oData }, { data: extData }] = await Promise.all([
    sb.from("opportunities").select("id,name,amount,stage,yomi,expected_close_date,first_meeting_date,last_activity_at,next_action_date,account_id,status").eq("status", "open"),
    sb.from("opportunity_review_extensions").select("*"),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const accIds = [...new Set(((oData ?? []) as any[]).map((o) => o.account_id).filter(Boolean))];
  const accMap = new Map<string, string>();
  if (accIds.length) {
    const { data: accs } = await sb.from("accounts").select("id,name").in("id", accIds);
    for (const a of accs ?? []) accMap.set(a.id, a.name);
  }
  const extByOpp = new Map((extData ?? []).map((e: any) => [e.existing_opportunity_id, e]));
  const todayStr = ymd(new Date());
  const summary: Record<string, { count: number; amount: number }> = { A: { count: 0, amount: 0 }, B: { count: 0, amount: 0 }, C: { count: 0, amount: 0 } };
  const rows: DealReadRow[] = ((oData ?? []) as any[]).map((o) => {
    const tier = o.yomi?.startsWith("1.A") ? "A" : o.yomi?.startsWith("2.B") ? "B" : o.yomi?.startsWith("3.C") ? "C" : "-";
    if (summary[tier]) { summary[tier].count++; summary[tier].amount += o.amount ?? 0; }
    const staleDays = o.last_activity_at ? Math.floor((Date.now() - +new Date(o.last_activity_at)) / 86400000) : null;
    const flags: string[] = [];
    if (staleDays != null && staleDays >= 12) flags.push("12日以上停滞");
    if (!o.next_action_date) flags.push("次回アクション未設定");
    if (tier === "A" && !o.expected_close_date) flags.push("A読みだがクロージング予定日未設定");
    return {
      id: o.id, account: accMap.get(o.account_id) ?? "—", name: o.name, amount: o.amount ?? 0, tier,
      yomi: o.yomi ?? "", expectedClose: o.expected_close_date ?? null, nextAction: o.next_action_date ?? null,
      staleDays, flags, ext: extByOpp.get(o.id) ?? null,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  rows.sort((a, b) => (a.tier > b.tier ? 1 : a.tier < b.tier ? -1 : b.amount - a.amount));
  void todayStr;
  return { rows, summary };
}

export interface DealReadRow {
  id: string; account: string; name: string; amount: number; tier: string; yomi: string;
  expectedClose: string | null; nextAction: string | null; staleDays: number | null; flags: string[];
  ext: { read_up_plan?: string; closing_plan?: string; blocking_issue?: string; executive_comment?: string; next_check_point?: string } | null;
}

// ===== Phase2: マーケ施策(既存campaigns流用) =====
import { judgeCampaign, type Evaluation as Ev } from "@/lib/exec-review";
import type { DeliveryReview, ProjectProfitReview, CampaignReviewExtension } from "@/lib/types";

export interface MarketingRow {
  id: string; name: string; channel: string; eventDate: string | null; done: boolean;
  expectedLeads: number; actualLeads: number; appts: number; cost: number;
  cpaPlan: number | null; cpaActual: number | null; apptRate: number | null;
  prepStatus: string; ext: CampaignReviewExtension | null; daysToEvent: number | null;
  evaluation: Ev; reasons: string[];
}
export async function getMarketingReview(month: string): Promise<{ rows: MarketingRow[]; leadTarget: number; planLeads: number; coverage: number | null; upcoming: MarketingRow[] }> {
  const sb = getSupabaseServer();
  const r = weekRange(month, 0);
  const today = new Date(); const todayStr = ymd(today);
  const horizon = ymd(new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()));
  const [{ data: cData }, { data: eData }, { data: stData }] = await Promise.all([
    sb.from("campaigns").select("id,name,channel,event_date,event_status,expected_leads,actual_leads,appointments,cost").or(`and(event_date.gte.${r.monthStart},event_date.lte.${r.monthEnd}),and(event_date.gte.${todayStr},event_date.lte.${horizon})`),
    sb.from("campaign_review_extensions").select("*"),
    sb.from("sales_targets").select("target_leads").eq("target_month", month),
  ]);
  const extByCamp = new Map((eData ?? []).map((e) => [(e as CampaignReviewExtension).campaign_id, e as CampaignReviewExtension]));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const toRow = (c: any): MarketingRow => {
    const ext = extByCamp.get(c.id) ?? null;
    const eventDate = c.event_date ?? null;
    const done = c.event_status === "done" || (eventDate != null && eventDate < todayStr);
    const expectedLeads = c.expected_leads ?? 0, actualLeads = c.actual_leads ?? 0, appts = c.appointments ?? 0, cost = c.cost ?? 0;
    const daysToEvent = eventDate ? Math.round((+new Date(eventDate) - +today) / 86400000) : null;
    const prepStatus = ext?.prep_status ?? (done ? "done" : "not_started");
    const j = judgeCampaign({ expectedLeads, actualLeads, appts, cost, daysToEvent, prepStatus, done });
    return {
      id: c.id, name: c.name, channel: c.channel, eventDate, done, expectedLeads, actualLeads, appts, cost,
      cpaPlan: expectedLeads > 0 ? cost / expectedLeads : null, cpaActual: actualLeads > 0 ? cost / actualLeads : null,
      apptRate: actualLeads > 0 ? appts / actualLeads : null, prepStatus, ext, daysToEvent,
      evaluation: j.evaluation, reasons: j.reasons,
    };
  };
  const all = (cData ?? []).map(toRow);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const rows = all.filter((c) => c.eventDate && c.eventDate >= r.monthStart && c.eventDate <= r.monthEnd);
  const upcoming = all.filter((c) => !c.done && c.daysToEvent != null && c.daysToEvent <= 30 && c.prepStatus !== "done" && c.prepStatus !== "reviewed");
  const leadTarget = ((stData ?? [])[0] as { target_leads?: number } | undefined)?.target_leads ?? 0;
  const planLeads = rows.reduce((s, c) => s + c.expectedLeads, 0);
  return { rows, leadTarget, planLeads, coverage: leadTarget > 0 ? planLeads / leadTarget : null, upcoming };
}

export async function listDeliveryReviews(): Promise<DeliveryReview[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("delivery_reviews").select("*").order("execution_date", { ascending: false, nullsFirst: false });
  return (data ?? []) as DeliveryReview[];
}
export async function listProjectProfitReviews(): Promise<ProjectProfitReview[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("project_profit_reviews").select("*").order("updated_at", { ascending: false });
  return (data ?? []) as ProjectProfitReview[];
}

export type { Evaluation };
