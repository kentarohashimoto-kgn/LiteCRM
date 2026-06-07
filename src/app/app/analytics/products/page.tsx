import { getWorkspace } from "@/lib/data/workspace";
import { listOpportunities } from "@/lib/data/select";
import { productMetrics } from "@/lib/analytics";
import { PageHeader, Section } from "@/components/ui/primitives";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { Tag } from "@/components/ui/badges";
import { formatYen, formatPercent } from "@/lib/utils";

export default async function ProductAnalyticsPage() {
  const ws = await getWorkspace();
  const opps = listOpportunities(ws);
  const products = productMetrics(opps);

  return (
    <div>
      <PageHeader title="商品別分析" subtitle="商材別の商談数・成約率・平均単価・粗利・LTVを分析します。" />

      <Section title="商品別 受注金額" className="mb-5">
        <SimpleBar data={products.map((p) => ({ label: p.name, value: p.wonAmount }))} color="#F59A2A" />
      </Section>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">商品</th>
              <th className="th">カテゴリ</th>
              <th className="th text-right">商談数</th>
              <th className="th text-right">進行中金額</th>
              <th className="th text-right">受注数</th>
              <th className="th text-right">受注金額</th>
              <th className="th text-right">成約率</th>
              <th className="th text-right">平均単価</th>
              <th className="th text-right">粗利</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {products.map((p) => (
              <tr key={p.productId} className="row-hover">
                <td className="td font-medium">{p.name}</td>
                <td className="td">{p.category && <Tag tone="gray">{p.category}</Tag>}</td>
                <td className="td text-right tabular-nums">{p.oppCount}</td>
                <td className="td text-right tabular-nums">{formatYen(p.openAmount)}</td>
                <td className="td text-right tabular-nums">{p.wonCount}</td>
                <td className="td text-right tabular-nums font-semibold text-teal-deep">{formatYen(p.wonAmount)}</td>
                <td className="td text-right tabular-nums">{formatPercent(p.winRate)}</td>
                <td className="td text-right tabular-nums">{formatYen(p.avgDealSize)}</td>
                <td className="td text-right tabular-nums text-ink/60">{formatYen(p.grossProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
