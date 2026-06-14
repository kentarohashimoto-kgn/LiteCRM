import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listOpportunities } from "@/lib/data/select";
import { getLeadMetrics } from "@/lib/data/leads";
import { channelMetrics } from "@/lib/analytics";
import { PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { ShareTrend, type TrendPoint } from "@/components/analytics/share-trend";
import { formatYen, formatPercent, monthKey, startOfMonth } from "@/lib/utils";

const TREND_PALETTE = [
  "#008C8C", "#F59A2A", "#3B82F6", "#8B5CF6", "#EC4899",
  "#10B981", "#EF4444", "#0EA5E9", "#A855F7", "#84CC16",
];

/** 主要施策のドリルダウン先(流入元名 → 詳細分析ページ)。今後 代理店/セミナー 等を追加。 */
const DRILLDOWN: Record<string, { href: string; label: string }> = {
  展示会: { href: "/app/analytics/exhibitions", label: "展示会分析" },
};

function num(v: number): string {
  return Math.round(v).toLocaleString("ja-JP");
}

export default async function LeadSourceAnalyticsPage() {
  const ws = await getWorkspaceLite();
  const opps = listOpportunities(ws);
  const channels = channelMetrics(opps, (await getLeadMetrics(opps)).bySource);

  const totalOpps = channels.reduce((s, c) => s + c.oppCount, 0);
  const totalWon = channels.reduce((s, c) => s + c.wonCount, 0);
  const totalLost = channels.reduce((s, c) => s + c.lostCount, 0);
  const totalWonAmount = channels.reduce((s, c) => s + c.wonAmount, 0);
  const totalWeighted = channels.reduce((s, c) => s + c.weighted, 0);
  const overallWinRate = totalWon + totalLost ? totalWon / (totalWon + totalLost) : 0;

  // 月別推移用: 流入元を系列に、案件数(作成日)/受注額(受注日)を月別集計
  const trendSeries = channels.map((c, i) => ({ key: c.sourceId, name: c.name, color: TREND_PALETTE[i % TREND_PALETTE.length] }));
  const countPoints: TrendPoint[] = [];
  const revPoints: TrendPoint[] = [];
  for (const o of opps) {
    if (!o.lead_source_id) continue;
    if (o.created_at) countPoints.push({ s: o.lead_source_id, m: monthKey(startOfMonth(new Date(o.created_at))), v: 1 });
    if (o.status === "won" && o.amount) {
      const ref = o.expected_close_date || o.expected_revenue_month;
      if (ref) revPoints.push({ s: o.lead_source_id, m: monthKey(startOfMonth(new Date(ref))), v: o.amount });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="流入元分析"
        subtitle="案件の流入元(展示会・代理店・パートナー・紹介 等)別に、受注・進行中・成約率・単価を分析します。"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="案件総数" raw={num(totalOpps) + " 件"} sub={`流入元 ${channels.length} 種`} />
        <StatCard label="受注金額(累計)" amount={totalWonAmount} accent sub={`受注 ${totalWon} 件`} />
        <StatCard label="進行中 Weighted" amount={totalWeighted} sub="加重パイプライン" />
        <StatCard label="全体成約率" raw={formatPercent(overallWinRate)} sub={`受注/(受注+失注) ${totalWon}/${totalWon + totalLost}`} />
      </div>

      <Section title="流入元別 受注金額">
        <SimpleBar data={channels.map((c) => ({ label: c.name, value: c.wonAmount }))} />
      </Section>

      <ShareTrend title="流入元別 月別推移" series={trendSeries} countPoints={countPoints} revPoints={revPoints} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">流入元</th>
              <th className="th text-right">案件数</th>
              <th className="th text-right">進行中</th>
              <th className="th text-right">Weighted</th>
              <th className="th text-right">受注数</th>
              <th className="th text-right">受注金額</th>
              <th className="th text-right">失注数</th>
              <th className="th text-right">成約率</th>
              <th className="th text-right">平均単価</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {channels.map((c) => {
              const drill = DRILLDOWN[c.name];
              return (
                <tr key={c.sourceId} className="row-hover">
                  <td className="td font-medium">{c.name}</td>
                  <td className="td text-right tabular-nums">{c.oppCount}</td>
                  <td className="td text-right tabular-nums text-ink/70">{c.openCount}</td>
                  <td className="td text-right tabular-nums text-teal-deep">{formatYen(c.weighted)}</td>
                  <td className="td text-right tabular-nums">{c.wonCount}</td>
                  <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(c.wonAmount)}</td>
                  <td className="td text-right tabular-nums text-ink/50">{c.lostCount}</td>
                  <td className="td text-right tabular-nums">{c.winRate ? formatPercent(c.winRate) : "—"}</td>
                  <td className="td text-right tabular-nums">{c.wonCount ? formatYen(c.avgDealSize) : "—"}</td>
                  <td className="td text-right">
                    {drill && (
                      <Link
                        href={drill.href}
                        className="inline-flex items-center gap-0.5 text-xs font-medium text-teal-primary hover:text-teal-deep whitespace-nowrap"
                      >
                        {drill.label}
                        <ArrowUpRight size={13} />
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {channels.length === 0 && (
              <tr><td colSpan={10} className="td text-center text-ink/40 py-10">案件データがありません</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/40 leading-relaxed">
        ※ 成約率は 受注/(受注+失注)。Weighted は進行中案件の 金額×確度。
        最重点施策の<b>展示会</b>はリード→アポ→成約→ROIまで<Link href="/app/analytics/exhibitions" className="text-teal-primary hover:underline">展示会分析</Link>でドリルダウンできます。
        代理店・セミナー・経営者アポ等の施策別ドリルダウンは、データが揃い次第このページから辿れるよう追加します。
      </p>
    </div>
  );
}
