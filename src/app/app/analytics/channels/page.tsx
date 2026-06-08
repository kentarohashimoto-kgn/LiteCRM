import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { listOpportunities, listLeads } from "@/lib/data/select";
import { channelMetrics } from "@/lib/analytics";
import { PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { formatYen, formatPercent } from "@/lib/utils";

/** 主要施策のドリルダウン先(流入元名 → 詳細分析ページ)。今後 代理店/セミナー 等を追加。 */
const DRILLDOWN: Record<string, { href: string; label: string }> = {
  展示会: { href: "/app/analytics/exhibitions", label: "展示会分析" },
};

function num(v: number): string {
  return Math.round(v).toLocaleString("ja-JP");
}

export default async function LeadSourceAnalyticsPage() {
  const ws = await getWorkspace();
  const opps = listOpportunities(ws);
  const leads = listLeads(ws);
  const channels = channelMetrics(opps, leads);

  const totalOpps = channels.reduce((s, c) => s + c.oppCount, 0);
  const totalWon = channels.reduce((s, c) => s + c.wonCount, 0);
  const totalLost = channels.reduce((s, c) => s + c.lostCount, 0);
  const totalWonAmount = channels.reduce((s, c) => s + c.wonAmount, 0);
  const totalWeighted = channels.reduce((s, c) => s + c.weighted, 0);
  const overallWinRate = totalWon + totalLost ? totalWon / (totalWon + totalLost) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="流入元分析"
        subtitle="商談の流入元(展示会・代理店・パートナー・紹介 等)別に、受注・進行中・成約率・単価を分析します。"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="商談総数" raw={num(totalOpps) + " 件"} sub={`流入元 ${channels.length} 種`} />
        <StatCard label="受注金額(累計)" amount={totalWonAmount} accent sub={`受注 ${totalWon} 件`} />
        <StatCard label="進行中 Weighted" amount={totalWeighted} sub="加重パイプライン" />
        <StatCard label="全体成約率" raw={formatPercent(overallWinRate)} sub={`受注/(受注+失注) ${totalWon}/${totalWon + totalLost}`} />
      </div>

      <Section title="流入元別 受注金額">
        <SimpleBar data={channels.map((c) => ({ label: c.name, value: c.wonAmount }))} />
      </Section>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">流入元</th>
              <th className="th text-right">商談数</th>
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
              <tr><td colSpan={10} className="td text-center text-ink/40 py-10">商談データがありません</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/40 leading-relaxed">
        ※ 成約率は 受注/(受注+失注)。Weighted は進行中商談の 金額×確度。
        最重点施策の<b>展示会</b>はリード→アポ→成約→ROIまで<Link href="/app/analytics/exhibitions" className="text-teal-primary hover:underline">展示会分析</Link>でドリルダウンできます。
        代理店・セミナー・経営者アポ等の施策別ドリルダウンは、データが揃い次第このページから辿れるよう追加します。
      </p>
    </div>
  );
}
