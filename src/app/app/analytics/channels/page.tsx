import { getWorkspace } from "@/lib/data/workspace";
import { listOpportunities, listLeads } from "@/lib/data/select";
import { channelMetrics } from "@/lib/analytics";
import { PageHeader, Section } from "@/components/ui/primitives";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { formatYen, formatPercent } from "@/lib/utils";

export default async function ChannelAnalyticsPage() {
  const ws = await getWorkspace();
  const opps = listOpportunities(ws);
  const leads = listLeads(ws);
  const channels = channelMetrics(opps, leads);

  return (
    <div>
      <PageHeader title="流入経路別分析" subtitle="チャネル別の商談化率・成約率・平均単価・LTVを分析します。" />

      <Section title="流入経路別 受注金額" className="mb-5">
        <SimpleBar data={channels.map((c) => ({ label: c.name, value: c.wonAmount }))} />
      </Section>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">流入経路</th>
              <th className="th text-right">リード数</th>
              <th className="th text-right">商談数</th>
              <th className="th text-right">商談化率</th>
              <th className="th text-right">受注数</th>
              <th className="th text-right">受注金額</th>
              <th className="th text-right">成約率</th>
              <th className="th text-right">平均単価</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {channels.map((c) => (
              <tr key={c.sourceId} className="row-hover">
                <td className="td font-medium">{c.name}</td>
                <td className="td text-right tabular-nums">{c.leadCount}</td>
                <td className="td text-right tabular-nums">{c.oppCount}</td>
                <td className="td text-right tabular-nums">{c.leadCount ? formatPercent(c.conversionRate) : "—"}</td>
                <td className="td text-right tabular-nums">{c.wonCount}</td>
                <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(c.wonAmount)}</td>
                <td className="td text-right tabular-nums">{formatPercent(c.winRate)}</td>
                <td className="td text-right tabular-nums">{formatYen(c.avgDealSize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/40 mt-3">CAC・ROIは獲得コストデータ連携後に対応予定です（将来）。</p>
    </div>
  );
}
