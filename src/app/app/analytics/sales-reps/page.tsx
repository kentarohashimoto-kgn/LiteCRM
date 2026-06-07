import { getWorkspace } from "@/lib/data/workspace";
import { listOpportunities } from "@/lib/data/select";
import { repMetrics } from "@/lib/analytics";
import { PageHeader, Section } from "@/components/ui/primitives";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { formatYen, formatPercent } from "@/lib/utils";

export default async function SalesRepAnalyticsPage() {
  const ws = await getWorkspace();
  const opps = listOpportunities(ws);
  const reps = repMetrics(opps);

  return (
    <div>
      <PageHeader title="営業マン別分析" subtitle="担当者別の行動量・受注率・単価・放置案件を可視化します。" />

      <Section title="受注金額" className="mb-5">
        <SimpleBar data={reps.map((r) => ({ label: r.name, value: r.wonAmount }))} />
      </Section>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">担当営業</th>
              <th className="th text-right">進行中</th>
              <th className="th text-right">進行中金額</th>
              <th className="th text-right">受注数</th>
              <th className="th text-right">受注金額</th>
              <th className="th text-right">受注率</th>
              <th className="th text-right">平均単価</th>
              <th className="th text-right">次AC設定率</th>
              <th className="th text-right">放置案件</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {reps.map((r) => (
              <tr key={r.userId} className="row-hover">
                <td className="td font-medium">{r.name}</td>
                <td className="td text-right tabular-nums">{r.openCount}</td>
                <td className="td text-right tabular-nums">{formatYen(r.openAmount)}</td>
                <td className="td text-right tabular-nums">{r.wonCount}</td>
                <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(r.wonAmount)}</td>
                <td className="td text-right tabular-nums">{formatPercent(r.winRate)}</td>
                <td className="td text-right tabular-nums">{formatYen(r.avgDealSize)}</td>
                <td className="td text-right tabular-nums">
                  <span className={r.nextActionRate < 0.8 ? "text-accent-orange font-medium" : ""}>{formatPercent(r.nextActionRate)}</span>
                </td>
                <td className="td text-right tabular-nums">
                  <span className={r.staleCount > 0 ? "text-rose-500 font-medium" : "text-ink/50"}>{r.staleCount}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
