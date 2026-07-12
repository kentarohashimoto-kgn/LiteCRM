import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * AIバッチ運用ダッシュボードのデータ取得。
 * 夜間バッチ(方針A / Claude Code方式)の運用ログ `batch_runs` を読み、
 * 週次の処理量・利用枠到達・夜間割合を集計する(ユーザー要望c)。
 * RLSにより自テナント分のみ取得される。
 */

export type BatchRun = {
  id: string;
  job_kind: string;
  run_date: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  targets_total: number;
  items_generated: number;
  items_failed: number;
  deferred_count: number;
  limit_hit: boolean;
  limit_hit_at: string | null;
  usage_note: string | null;
  detail: Record<string, unknown> | null;
};

export type WeeklyBucket = {
  weekStart: string; // 週初(月曜)の YYYY-MM-DD
  runs: number;
  generated: number;
  failed: number;
  deferred: number;
  limitHitRuns: number;
};

export type BatchDashboard = {
  runs: BatchRun[]; // 直近(新しい順)
  weekly: WeeklyBucket[]; // 新しい週が先頭
  thisWeekGenerated: number;
  thisWeekLimitHits: number;
  total8wGenerated: number;
  nightlyShare: number | null; // 夜間トリガの割合(0-100)。判定不能なら null
  lastRunAt: string | null;
};

/** 'YYYY-MM-DD' の週初(月曜)を UTC 基準で返す。run_date は JST日付なのでUTC正午扱いでズレない。 */
function weekStartOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0=日..6=土
  const diff = (dow + 6) % 7; // 月曜からの経過日数
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export async function getBatchDashboard(): Promise<BatchDashboard> {
  const sb = getSupabaseServer();
  // 直近~9週(63日)分。件数は多くならない想定(1日数本)。
  const since = new Date();
  since.setDate(since.getDate() - 63);
  const { data } = await sb
    .from("batch_runs")
    .select(
      "id,job_kind,run_date,started_at,ended_at,status,targets_total,items_generated,items_failed,deferred_count,limit_hit,limit_hit_at,usage_note,detail",
    )
    .gte("run_date", since.toISOString().slice(0, 10))
    .order("started_at", { ascending: false })
    .limit(500);

  const runs = (data ?? []) as BatchRun[];

  // 週次バケット集計
  const byWeek = new Map<string, WeeklyBucket>();
  for (const r of runs) {
    const wk = weekStartOf(r.run_date);
    const b =
      byWeek.get(wk) ??
      { weekStart: wk, runs: 0, generated: 0, failed: 0, deferred: 0, limitHitRuns: 0 };
    b.runs += 1;
    b.generated += r.items_generated ?? 0;
    b.failed += r.items_failed ?? 0;
    b.deferred += r.deferred_count ?? 0;
    if (r.limit_hit) b.limitHitRuns += 1;
    byWeek.set(wk, b);
  }
  const weekly = Array.from(byWeek.values()).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));

  const thisWeek = weekStartOf(new Date().toISOString().slice(0, 10));
  const tw = byWeek.get(thisWeek);

  // 夜間割合: detail.trigger を持つ実行のうち 'nightly' の割合
  const withTrigger = runs.filter((r) => typeof r.detail?.trigger === "string");
  const nightly = withTrigger.filter((r) => r.detail?.trigger === "nightly").length;
  const nightlyShare = withTrigger.length ? Math.round((nightly / withTrigger.length) * 100) : null;

  return {
    runs,
    weekly,
    thisWeekGenerated: tw?.generated ?? 0,
    thisWeekLimitHits: tw?.limitHitRuns ?? 0,
    total8wGenerated: runs.reduce((s, r) => s + (r.items_generated ?? 0), 0),
    nightlyShare,
    lastRunAt: runs[0]?.started_at ?? null,
  };
}
