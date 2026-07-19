import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { getWinLossAnalysis } from "@/lib/data/win-loss";
import { WinLossView } from "@/components/analytics/win-loss-view";
import { formatYen } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** 月別失注(受注予定月ベース・直近12ヶ月)。旧 /app/analytics/lost の独自セクションを吸収(S2-1)。 */
async function fetchLostByMonth(): Promise<{ month: string; count: number; amount: number }[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("opportunities")
    .select("amount,expected_close_date,updated_at")
    .eq("status", "lost")
    .order("updated_at", { ascending: false })
    .limit(1000);
  const byMonth = new Map<string, { count: number; amount: number }>();
  for (const r of data ?? []) {
    const d = (r.expected_close_date ?? r.updated_at) as string | null;
    const month = d ? d.slice(0, 7) : "—";
    const cur = byMonth.get(month) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += r.amount ?? 0;
    byMonth.set(month, cur);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 12)
    .map(([month, v]) => ({ month, ...v }));
}

/**
 * C-4 失注/成約 分析。なぜ勝ったか・負けたかを 理由コード/競合/カテゴリ/月別 で可視化し、
 * 自由記述の失注理由は生記録として振り返れるようにする。
 * 旧「失注分析」(/app/analytics/lost)は本ページへ統合済み(docs/IA_MENU_REORG_PLAN_2026-07.md S2-1)。
 */
export default async function WinLossPage() {
  await requireCtx();
  const [data, lostByMonth] = await Promise.all([getWinLossAnalysis(), fetchLostByMonth()]);

  return (
    <div>
      <PageHeader
        title="失注/成約 分析"
        subtitle="なぜ勝ったか・負けたかを理由・競合・カテゴリ・月別で可視化。負け筋を見つけ、型(プレイブック)やノウハウに還元します。"
      />
      <WinLossView data={data} />
      <div className="mt-6">
        <Section title="月別 失注（受注予定月ベース・直近12ヶ月）">
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50 border-b border-black/[0.06]">
                  <th className="px-4 py-2">月</th>
                  <th className="px-4 py-2 text-right">件数</th>
                  <th className="px-4 py-2 text-right">金額</th>
                </tr>
              </thead>
              <tbody>
                {lostByMonth.length === 0 && (
                  <tr><td className="px-4 py-3 text-ink/50" colSpan={3}>失注データがまだありません。</td></tr>
                )}
                {lostByMonth.map((m) => (
                  <tr key={m.month} className="border-b border-black/[0.04] last:border-0">
                    <td className="px-4 py-2 font-medium">{m.month}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m.count}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatYen(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>
      </div>
    </div>
  );
}
