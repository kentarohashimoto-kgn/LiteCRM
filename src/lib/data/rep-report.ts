import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listOpportunities, listMembers, listRepTargets, listAccounts } from "@/lib/data/select";
import { isStale, isAtRisk } from "@/lib/risk";
import { sameMonth, monthKey, startOfMonth } from "@/lib/utils";

/**
 * 営業マン別 週報。自動集計(目標/実績/見込み/パイプライン/担当案件)は既存データから算出し、
 * ナラティブ(先週コメント/来週予定/1ヶ月先予定)は weekly_rep_reports に保存する。
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

export type RepReport = {
  members: { id: string; name: string }[];
  ownerId: string;
  ownerName: string;
  month: { target: number; actual: number; forecast: number; achieve: number };
  pipeline: { openCount: number; openAmount: number; weighted: number; stalled: number; risky: number; closingCount: number; closingAmount: number };
  opps: RepReportOpp[];
  narrative: RepNarrative | null;
};

const sum = <T>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + (f(x) || 0), 0);

export async function getRepReport(ownerId: string, weekStart: string): Promise<RepReport> {
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name }));
  const accountsById = new Map(listAccounts(ws).map((a) => [a.id, a.name as string]));
  const now = new Date();
  const thisKey = monthKey(startOfMonth(now));

  const mine = listOpportunities(ws).filter((o) => o.owner_user_id === ownerId);
  const open = mine.filter((o) => o.status === "open");
  const wonThisMonth = mine.filter((o) => o.status === "won" && sameMonth(o.expected_close_date, now));
  const closingOpen = open.filter((o) => sameMonth(o.expected_close_date, now));

  const target = listRepTargets(ws).find((t) => t.user_id === ownerId && t.target_month === thisKey)?.target_amount ?? 0;
  const actual = sum(wonThisMonth, (o) => o.amount);
  const forecast = actual + sum(closingOpen, (o) => o.weighted);

  const sb = getSupabaseServer();

  // 担当の読み(新設カラム)は workspace RPC に含まれないため直接取得してマージ
  const top = [...open].sort((a, b) => b.amount - a.amount).slice(0, 60);
  const forecastById = new Map<string, { m: string | null; a: number | null; l: number | null }>();
  if (top.length) {
    const { data: fc } = await sb
      .from("opportunities")
      .select("id,rep_close_month,rep_amount_forecast,rep_meetings_left")
      .in("id", top.map((o) => o.id));
    for (const r of (fc ?? []) as { id: string; rep_close_month: string | null; rep_amount_forecast: number | null; rep_meetings_left: number | null }[]) {
      forecastById.set(r.id, { m: r.rep_close_month, a: r.rep_amount_forecast, l: r.rep_meetings_left });
    }
  }

  const opps: RepReportOpp[] = top.map((o) => {
    const fc = forecastById.get(o.id);
    return {
      id: o.id,
      name: o.name,
      account: o.account_id ? accountsById.get(o.account_id) ?? null : null,
      yomi: o.yomi ?? null,
      amount: o.amount,
      weighted: o.weighted,
      nextActionDate: o.next_action_date ?? null,
      expectedClose: o.expected_close_date ?? null,
      repCloseMonth: fc?.m ?? null,
      repAmountForecast: fc?.a ?? null,
      repMeetingsLeft: fc?.l ?? null,
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
    opps,
    narrative: (nar as RepNarrative) ?? null,
  };
}
