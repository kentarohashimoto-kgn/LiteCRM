import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listOpportunities, listMembers, listRepTargets, listAccounts } from "@/lib/data/select";
import { isStale, isAtRisk } from "@/lib/risk";
import { sameMonth, monthKey, startOfMonth, addMonths } from "@/lib/utils";

/**
 * 営業マン別 週報。自動集計(目標/実績/見込み/パイプライン/ファネル/推移/担当案件)は既存データから算出し、
 * ナラティブ(先週コメント/来週予定/1ヶ月先予定)＋保存時サマリーを weekly_rep_reports に保存する。
 */

export type RepReportOpp = {
  id: string;
  name: string;
  account: string | null;
  yomi: string | null;
  amount: number;
  weighted: number;
  nextActionDate: string | null;
  expectedClose: string | null;
  lastActivityAt: string | null; // 直近活動(≒直近商談日)
  riskLevel: string | null; // 重要度(risk_level)
  statusNote: string | null; // 1行メモ
  // 担当の読み(自分の予測): 成約月/売上額/残商談回数
  repCloseMonth: string | null;
  repAmountForecast: number | null;
  repMeetingsLeft: number | null;
};

export type RepNarrative = {
  last_week_comment: string | null;
  next_week_plan: string | null;
  month_ahead_plan: string | null;
  note: string | null;
};

export type FunnelBucket = { code: string; label: string; count: number; amount: number };
export type TrendPoint = { label: string; target: number; actual: number };

export type RepReport = {
  members: { id: string; name: string }[];
  ownerId: string;
  ownerName: string;
  monthKey: string;
  month: { target: number; actual: number; forecast: number; achieve: number };
  pipeline: { openCount: number; openAmount: number; weighted: number; stalled: number; risky: number; closingCount: number; closingAmount: number };
  funnel: FunnelBucket[];
  trendMonthly: TrendPoint[];
  trendWeekly: TrendPoint[];
  opps: RepReportOpp[];
  narrative: RepNarrative | null;
};

const sum = <T>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + (f(x) || 0), 0);

/** ファネル表示順(受注→前段→保留/失注)。 */
const YOMI_FUNNEL: { code: string; label: string }[] = [
  { code: "0", label: "受注" },
  { code: "1", label: "A(80%)" },
  { code: "2", label: "B(50%)" },
  { code: "3", label: "C(30%)" },
  { code: "4", label: "アポ" },
  { code: "6", label: "定期追い" },
  { code: "9", label: "調整中" },
  { code: "5", label: "リスケ" },
  { code: "7", label: "オチ" },
  { code: "8", label: "キャンセル" },
];

function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diff = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

export async function getRepReport(ownerId: string, weekStart: string): Promise<RepReport> {
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name }));
  const accountsById = new Map(listAccounts(ws).map((a) => [a.id, a.name as string]));
  const repTargets = listRepTargets(ws);
  const now = new Date();
  const thisKey = monthKey(startOfMonth(now));

  const mine = listOpportunities(ws).filter((o) => o.owner_user_id === ownerId);
  const won = mine.filter((o) => o.status === "won");
  const open = mine.filter((o) => o.status === "open");
  const wonThisMonth = won.filter((o) => sameMonth(o.expected_close_date, now));
  const closingOpen = open.filter((o) => sameMonth(o.expected_close_date, now));

  const targetFor = (key: string) => repTargets.find((t) => t.user_id === ownerId && t.target_month === key)?.target_amount ?? 0;
  const target = targetFor(thisKey);
  const actual = sum(wonThisMonth, (o) => o.amount);
  const forecast = actual + sum(closingOpen, (o) => o.weighted);

  // ファネル(ヨミ別 件数/金額): 全案件(受注含む)を先頭コードで集計
  const funnel: FunnelBucket[] = YOMI_FUNNEL.map((b) => {
    const rows = mine.filter((o) => (o.yomi ?? "").charAt(0) === b.code);
    return { code: b.code, label: b.label, count: rows.length, amount: sum(rows, (o) => o.amount) };
  }).filter((b) => b.count > 0);

  // 月次推移(直近6ヶ月): 目標 vs 実績(受注額)
  const trendMonthly: TrendPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = startOfMonth(addMonths(now, -i));
    const key = monthKey(d);
    const label = `${d.getMonth() + 1}月`;
    const act = sum(won.filter((o) => o.expected_close_date && monthKey(startOfMonth(new Date(o.expected_close_date))) === key), (o) => o.amount);
    trendMonthly.push({ label, target: targetFor(key), actual: act });
  }

  // 週次推移(直近8週): 実績=その週の受注額 / 目標=月目標を日数按分
  const trendWeekly: TrendPoint[] = [];
  const baseMonday = mondayOf(now);
  for (let i = 7; i >= 0; i--) {
    const ws0 = new Date(baseMonday);
    ws0.setUTCDate(ws0.getUTCDate() - i * 7);
    const we0 = new Date(ws0);
    we0.setUTCDate(we0.getUTCDate() + 7);
    const s = ymd(ws0);
    const e = ymd(we0);
    const act = sum(
      won.filter((o) => o.expected_close_date && o.expected_close_date >= s && o.expected_close_date < e),
      (o) => o.amount,
    );
    const mKey = monthKey(startOfMonth(new Date(Date.UTC(ws0.getUTCFullYear(), ws0.getUTCMonth(), ws0.getUTCDate()))));
    const mTarget = targetFor(mKey);
    const dim = daysInMonth(ws0.getUTCFullYear(), ws0.getUTCMonth());
    trendWeekly.push({ label: `${ws0.getUTCMonth() + 1}/${ws0.getUTCDate()}`, target: Math.round((mTarget * 7) / dim), actual: act });
  }

  const sb = getSupabaseServer();
  // 上位200件(進行中)。新設カラム(rep_*/status_note)＋直近活動/重要度を直接取得してマージ。
  const top = [...open].sort((a, b) => b.amount - a.amount).slice(0, 200);
  const extraById = new Map<string, { m: string | null; a: number | null; l: number | null; note: string | null; last: string | null; risk: string | null }>();
  if (top.length) {
    const { data: ex } = await sb
      .from("opportunities")
      .select("id,rep_close_month,rep_amount_forecast,rep_meetings_left,rep_status_note,last_activity_at,risk_level")
      .in("id", top.map((o) => o.id));
    for (const r of (ex ?? []) as { id: string; rep_close_month: string | null; rep_amount_forecast: number | null; rep_meetings_left: number | null; rep_status_note: string | null; last_activity_at: string | null; risk_level: string | null }[]) {
      extraById.set(r.id, { m: r.rep_close_month, a: r.rep_amount_forecast, l: r.rep_meetings_left, note: r.rep_status_note, last: r.last_activity_at, risk: r.risk_level });
    }
  }

  const opps: RepReportOpp[] = top.map((o) => {
    const ex = extraById.get(o.id);
    return {
      id: o.id,
      name: o.name,
      account: o.account_id ? accountsById.get(o.account_id) ?? null : null,
      yomi: o.yomi ?? null,
      amount: o.amount,
      weighted: o.weighted,
      nextActionDate: o.next_action_date ?? null,
      expectedClose: o.expected_close_date ?? null,
      lastActivityAt: ex?.last ?? null,
      riskLevel: ex?.risk ?? null,
      statusNote: ex?.note ?? null,
      repCloseMonth: ex?.m ?? null,
      repAmountForecast: ex?.a ?? null,
      repMeetingsLeft: ex?.l ?? null,
    };
  });

  const { data: nar } = await sb
    .from("weekly_rep_reports")
    .select("last_week_comment,next_week_plan,month_ahead_plan,note")
    .eq("owner_user_id", ownerId)
    .eq("week_start", weekStart)
    .maybeSingle();

  return {
    members,
    ownerId,
    ownerName: members.find((m) => m.id === ownerId)?.name ?? "—",
    monthKey: thisKey,
    month: { target, actual, forecast, achieve: target > 0 ? forecast / target : 0 },
    pipeline: {
      openCount: open.length,
      openAmount: sum(open, (o) => o.amount),
      weighted: sum(open, (o) => o.weighted),
      stalled: open.filter((o) => isStale(o, now)).length,
      risky: open.filter((o) => isAtRisk(o, now)).length,
      closingCount: closingOpen.length,
      closingAmount: sum(closingOpen, (o) => o.amount),
    },
    funnel,
    trendMonthly,
    trendWeekly,
    opps,
    narrative: (nar as RepNarrative) ?? null,
  };
}
