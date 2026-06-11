import { getWorkspace } from "@/lib/data/workspace";
import { listOpportunities } from "@/lib/data/select";
import { productMetrics } from "@/lib/analytics";
import { PageHeader, Section } from "@/components/ui/primitives";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { ShareTrend, type TrendPoint } from "@/components/analytics/share-trend";
import { Tag } from "@/components/ui/badges";
import { formatYen, formatPercent, monthKey, startOfMonth } from "@/lib/utils";

const TREND_PALETTE = [
  "#F59A2A", "#008C8C", "#3B82F6", "#8B5CF6", "#EC4899",
  "#10B981", "#EF4444", "#0EA5E9", "#A855F7", "#84CC16",
];

export default async function ProductAnalyticsPage() {
  const ws = await getWorkspace();
  const opps = listOpportunities(ws);
  const products = productMetrics(opps);

  // 月別推移(商品別シェア): 上位10商品 + その他
  const top = products.slice(0, 10);
  const overflow = new Set(products.slice(10).map((p) => p.productId));
  const series = [
    ...top.map((p, i) => ({ key: p.productId, name: p.name, color: TREND_PALETTE[i % TREND_PALETTE.length] })),
    ...(overflow.size ? [{ key: "__other", name: "その他", color: "#CBD5E1" }] : []),
  ];
  const countPoints: TrendPoint[] = [];
  const revPoints: TrendPoint[] = [];
  for (const o of opps) {
    if (!o.primary_product_id) continue;
    const s = overflow.has(o.primary_product_id) ? "__other" : o.primary_product_id;
    if (o.created_at) countPoints.push({ s, m: monthKey(startOfMonth(new Date(o.created_at))), v: 1 });
    if (o.status === "won" && o.amount) {
      const ref = o.expected_close_date || o.expected_revenue_month;
      if (ref) revPoints.push({ s, m: monthKey(startOfMonth(new Date(ref))), v: o.amount });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="商品別分析" subtitle="商材別の案件数・成約率・平均単価・粗利・LTVと、月別/年度のシェア推移を分析します。" />

      <Section title="商品別 受注金額">
        <SimpleBar data={products.map((p) => ({ label: p.name, value: p.wonAmount }))} color="#F59A2A" />
      </Section>

      <ShareTrend title="商品別 月別推移・シェア" series={series} countPoints={countPoints} revPoints={revPoints} />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">商品</th>
              <th className="th">カテゴリ</th>
              <th className="th text-right">案件数</th>
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
