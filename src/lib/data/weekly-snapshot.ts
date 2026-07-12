import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSalesTargets, listOpportunities } from "@/lib/data/select";
import { buildForecast } from "@/lib/forecast";
import { repMetrics } from "@/lib/analytics";
import { isStale, isAtRisk } from "@/lib/risk";
import { sameMonth } from "@/lib/utils";

/**
 * 週報スナップショットのデータ。
 * 週次レビューの主要数値を1つの payload にまとめ、保存・過去参照・2世代比較に使う。
 */

export type WeeklyMonth = {
  label: string;
  target: number;
  commit: number;
  bestCase: number;
  weighted: number;
  gap: number;
  achieve: number;
};

export type WeeklyRep = {
  name: string;
  openCount: number;
  openAmount: number;
  weighted: number;
  staleCount: number;
};

export type WeeklyPayload = {
  takenAt: string;
  weekStart: string;
  months: WeeklyMonth[];
  pipeline: {
    openCount: number;
    openAmount: number;
    weighted: number;
    stalled: number;
    risky: number;
    closingCount: number;
    closingAmount: number;
  };
  reps: WeeklyRep[];
};

export type WeeklySnapshotMeta = {
  id: string;
  week_start: string;
  label: string | null;
  note: string | null;
  taken_at: string;
};

export type WeeklySnapshotFull = WeeklySnapshotMeta & { payload: WeeklyPayload };

const sum = <T>(list: T[], f: (x: T) => number): number => list.reduce((s, x) => s + (f(x) || 0), 0);

/** 週初(月曜, JST)の YYYY-MM-DD。 */
export function mondayJst(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const diff = (jst.getUTCDay() + 6) % 7;
  jst.setUTCDate(jst.getUTCDate() - diff);
  return jst.toISOString().slice(0, 10);
}

/** 現在の週次サマリ(主要数値)を組み立てる。RLSにより保存者の閲覧範囲で集計される。 */
export async function buildWeeklyPayload(now = new Date()): Promise<WeeklyPayload> {
  const lite = await getWorkspaceLite();
  const opps = listOpportunities(lite);
  const open = opps.filter((o) => o.status === "open");
  const targets = getSalesTargets(lite);
  const buckets = buildForecast(opps, targets, 2, now);

  const months: WeeklyMonth[] = buckets.map((b, i) => ({
    label: i === 0 ? "今月" : "来月",
    target: b.target,
    commit: b.commit,
    bestCase: b.bestCase,
    weighted: b.weighted,
    gap: b.gap,
    achieve: b.target > 0 ? b.bestCase / b.target : 0,
  }));

  const closing = open.filter((o) => sameMonth(o.expected_close_date, now));
  const reps: WeeklyRep[] = repMetrics(open)
    .map((r) => ({ name: r.name, openCount: r.openCount, openAmount: r.openAmount, weighted: r.weighted, staleCount: r.staleCount }))
    .sort((a, b) => b.openAmount - a.openAmount);

  return {
    takenAt: now.toISOString(),
    weekStart: mondayJst(now),
    months,
    pipeline: {
      openCount: open.length,
      openAmount: sum(open, (o) => o.amount),
      weighted: sum(open, (o) => o.weighted),
      stalled: open.filter((o) => isStale(o, now)).length,
      risky: open.filter((o) => isAtRisk(o, now)).length,
      closingCount: closing.length,
      closingAmount: sum(closing, (o) => o.amount),
    },
    reps,
  };
}

export async function listWeeklySnapshots(): Promise<WeeklySnapshotMeta[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("weekly_report_snapshots")
    .select("id,week_start,label,note,taken_at")
    .order("taken_at", { ascending: false })
    .limit(100);
  return (data ?? []) as WeeklySnapshotMeta[];
}

export async function getWeeklySnapshotsByIds(ids: string[]): Promise<WeeklySnapshotFull[]> {
  const clean = ids.filter(Boolean);
  if (clean.length === 0) return [];
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("weekly_report_snapshots")
    .select("id,week_start,label,note,taken_at,payload")
    .in("id", clean);
  return (data ?? []) as WeeklySnapshotFull[];
}
