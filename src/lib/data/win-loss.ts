import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * C-4 失注/成約 分析。opportunities(won/lost)を単一テーブルで取得し、
 * 構造化フィールド(理由コード/競合/カテゴリ)で集計する。自由記述の理由は読み物として併記。
 * 件数が小さい(数百)ためJS集計で十分(RPC不要)。RLSで担当範囲のみ。
 */

export type Grouped = { key: string; count: number; amount: number };

export type WinLossData = {
  wonCount: number;
  wonAmount: number;
  lostCount: number;
  winRate: number; // won / (won+lost)
  lostByReason: Grouped[];
  lostByCompetitor: Grouped[];
  byCategory: { category: string; won: number; lost: number; winRate: number }[];
  recentLost: { id: string; name: string; account: string | null; amount: number; reason: string | null; closedAt: string | null }[];
};

type Row = {
  id: string;
  name: string | null;
  status: string;
  amount: number | null;
  category: string | null;
  lost_reason: string | null;
  lost_reason_code: string | null;
  lost_competitor: string | null;
  competitor: string | null;
  expected_close_date: string | null;
  updated_at: string | null;
  accounts: { name: string | null } | null;
};

function groupBy(rows: Row[], keyOf: (r: Row) => string): Grouped[] {
  const m = new Map<string, Grouped>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = m.get(key) ?? { key, count: 0, amount: 0 };
    g.count += 1;
    g.amount += r.amount ?? 0;
    m.set(key, g);
  }
  return Array.from(m.values()).sort((a, b) => b.count - a.count);
}

export async function getWinLossAnalysis(): Promise<WinLossData> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("opportunities")
    .select(
      "id,name,status,amount,category,lost_reason,lost_reason_code,lost_competitor,competitor,expected_close_date,updated_at,accounts(name)",
    )
    .in("status", ["won", "lost"])
    .is("deleted_at", null)
    .limit(3000);

  const rows = (data ?? []) as unknown as Row[];
  const won = rows.filter((r) => r.status === "won");
  const lost = rows.filter((r) => r.status === "lost");

  const lostByReason = groupBy(lost, (r) => (r.lost_reason_code?.trim() || "未分類（自由記述のみ）"));
  const lostByCompetitor = groupBy(
    lost.filter((r) => (r.lost_competitor || r.competitor)?.trim()),
    (r) => (r.lost_competitor?.trim() || r.competitor?.trim() || "—"),
  );

  const catKeys = Array.from(new Set(rows.map((r) => r.category?.trim() || "未設定")));
  const byCategory = catKeys
    .map((category) => {
      const w = won.filter((r) => (r.category?.trim() || "未設定") === category).length;
      const l = lost.filter((r) => (r.category?.trim() || "未設定") === category).length;
      return { category, won: w, lost: l, winRate: w + l > 0 ? w / (w + l) : 0 };
    })
    .sort((a, b) => b.won + b.lost - (a.won + a.lost));

  const recentLost = [...lost]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 25)
    .map((r) => ({
      id: r.id,
      name: r.name ?? "—",
      account: r.accounts?.name ?? null,
      amount: r.amount ?? 0,
      reason: r.lost_reason,
      closedAt: r.expected_close_date ?? r.updated_at,
    }));

  return {
    wonCount: won.length,
    wonAmount: won.reduce((s, r) => s + (r.amount ?? 0), 0),
    lostCount: lost.length,
    winRate: won.length + lost.length > 0 ? won.length / (won.length + lost.length) : 0,
    lostByReason,
    lostByCompetitor,
    byCategory,
    recentLost,
  };
}
