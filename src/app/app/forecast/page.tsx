import { getWorkspace } from "@/lib/data/workspace";
import { getSalesTargets, listOpportunities } from "@/lib/data/select";
import { buildForecast, summarizePeriod } from "@/lib/forecast";
import { repMetrics, productMetrics } from "@/lib/analytics";
import { PageHeader, Section, StatCard, Card } from "@/components/ui/primitives";
import { ForecastChart, SimpleBar } from "@/components/charts/forecast-chart";
import { formatYen } from "@/lib/utils";

export default async function ForecastPage() {
  const ws = await getWorkspace();
  const now = new Date();
  const opps = listOpportunities(ws);
  const targets = getSalesTargets(ws);
  const buckets = buildForecast(opps, targets, 12, now);

  const thisMonth = summarizePeriod(buckets, 0, 1, "今月");
  const nextMonth = summarizePeriod(buckets, 1, 2, "来月");
  const quarter = summarizePeriod(buckets, 0, 3, "今四半期(3ヶ月)");

  const open = opps.filter((o) => o.status === "open");
  const reps = repMetrics(open);
  const products = productMetrics(open).slice(0, 8);

  return (
    <div>
      <PageHeader title="売上予測" subtitle="今月・来月・四半期・12ヶ月先の売上見込み。weighted = 金額 × 確度。" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {[thisMonth, nextMonth, quarter].map((p) => (
          <Card key={p.label}>
            <div className="text-sm font-semibold text-ink mb-3">{p.label}</div>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-ink/50">目標</span><span className="text-right tabular-nums">{formatYen(p.target)}</span>
              <span className="text-ink/50">Commit</span><span className="text-right tabular-nums font-semibold text-teal-deep">{formatYen(p.commit)}</span>
              <span className="text-ink/50">Best Case込み</span><span className="text-right tabular-nums">{formatYen(p.bestCase)}</span>
              <span className="text-ink/50">Weighted</span><span className="text-right tabular-nums">{formatYen(p.weighted)}</span>
              <span className="text-ink/50">Gap</span>
              <span className={`text-right tabular-nums font-bold ${p.gap >= 0 ? "text-teal-deep" : "stat-accent"}`}>{formatYen(p.gap)}</span>
            </div>
          </Card>
        ))}
      </div>

      <Section title="月別売上予測(12ヶ月ローリング)" className="mb-5">
        <ForecastChart
          data={buckets.map((b) => ({
            label: b.label,
            commit: b.commit,
            bestCase: Math.max(0, b.bestCase - b.commit),
            pipeline: b.pipeline,
            weighted: b.weighted,
            target: b.target,
          }))}
        />
      </Section>

      <div className="card overflow-x-auto mb-5">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">月</th>
              <th className="th text-right">目標</th>
              <th className="th text-right">Commit</th>
              <th className="th text-right">Best Case込み</th>
              <th className="th text-right">Pipeline</th>
              <th className="th text-right">Weighted</th>
              <th className="th text-right">Gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {buckets.map((b) => (
              <tr key={b.monthKey} className="row-hover">
                <td className="td font-medium">{b.label}</td>
                <td className="td text-right tabular-nums text-ink/60">{formatYen(b.target)}</td>
                <td className="td text-right tabular-nums font-semibold text-teal-deep">{formatYen(b.commit)}</td>
                <td className="td text-right tabular-nums">{formatYen(b.bestCase)}</td>
                <td className="td text-right tabular-nums text-ink/60">{formatYen(b.pipeline)}</td>
                <td className="td text-right tabular-nums">{formatYen(b.weighted)}</td>
                <td className={`td text-right tabular-nums font-semibold ${b.gap >= 0 ? "text-teal-deep" : "text-accent-orange"}`}>{formatYen(b.gap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="営業マン別 Weighted予測">
          <SimpleBar data={reps.map((r) => ({ label: r.name, value: r.weighted }))} />
        </Section>
        <Section title="商品別 進行中予測">
          <SimpleBar data={products.map((p) => ({ label: p.name, value: p.openAmount }))} color="#F59A2A" />
        </Section>
      </div>
    </div>
  );
}
