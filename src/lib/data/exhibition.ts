/** 展示会選定のデータ(スコア＋日程の詰まりを全候補から算出)。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { scoreExhibition, expectedRevenueOf, type ExhScore } from "@/lib/exhibition";
import type { ExhibitionCandidate } from "@/lib/types";

export interface ExhRow extends ExhibitionCandidate {
  score: ExhScore;
  revenue: number;
}

export async function listExhibitionCandidates(): Promise<ExhRow[]> {
  const sb = getSupabaseServer();
  const { data } = await sb.from("exhibition_candidates").select("*");
  const cands = (data ?? []) as ExhibitionCandidate[];

  // 日程の詰まり: 見送り以外の候補同士で、最も近い開催日との差(日)
  const dated = cands.filter((c) => c.event_date && c.status !== "skip");
  const tightOf = (c: ExhibitionCandidate): number | null => {
    if (!c.event_date || c.status === "skip") return null;
    let min: number | null = null;
    for (const o of dated) {
      if (o.id === c.id || !o.event_date) continue;
      const d = Math.abs(Math.round((+new Date(c.event_date) - +new Date(o.event_date)) / 86400000));
      if (min == null || d < min) min = d;
    }
    return min;
  };

  const rows = cands.map((c) => ({ ...c, score: scoreExhibition(c, tightOf(c)), revenue: expectedRevenueOf(c) }));
  // 申込済/実施済は下げ、検討系を上に。同条件はスコア降順。
  const activeOrder = (s: string) => (s === "considering" || s === "apply_planned" ? 0 : 1);
  rows.sort((a, b) => activeOrder(a.status) - activeOrder(b.status) || b.score.total - a.score.total);
  return rows;
}
