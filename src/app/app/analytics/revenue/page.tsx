import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { StackedTrendChart } from "@/components/charts/stacked-trend-chart";
import { CATEGORIES } from "@/lib/constants";
import { ordersByMonth, expandBilling, monthRange, monthlyStacks, type MonthCol } from "@/lib/revenue";
import { currentFiscalStartYear, fiscalMonths, fiscalYearLabel } from "@/lib/fiscal";
import { formatYen } from "@/lib/utils";
import type { OpportunityCategory } from "@/lib/types";

function CategoryLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
      {CATEGORIES.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 text-[11px] text-ink/70">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

export default async function RevenueAnalyticsPage({ searchParams }: { searchParams: { fy?: string } }) {
  const ws = await getWorkspace();
  const opps = ws.opportunities;
  const catMap = new Map<string, OpportunityCategory | undefined>(opps.map((o) => [o.id, o.category]));

  const orderPoints = ordersByMonth(opps);
  const billingPoints = expandBilling(ws.billingSchedules, (id) => catMap.get(id));

  const cur = currentFiscalStartYear();
  const fyParam = searchParams.fy ?? "all";
  const cols: MonthCol[] =
    fyParam === "all"
      ? monthRange([orderPoints, billingPoints])
      : fiscalMonths(parseInt(fyParam, 10)).map((m) => ({ key: m.key, label: `${m.year % 100}/${m.month}` }));
  const fyOptions: { v: string; label: string }[] = [
    { v: "all", label: "全期間" },
    { v: String(cur - 1), label: fiscalYearLabel(cur - 1) },
    { v: String(cur), label: fiscalYearLabel(cur) },
    { v: String(cur + 1), label: fiscalYearLabel(cur + 1) },
  ];

  const orders = monthlyStacks(orderPoints, cols);
  const billing = monthlyStacks(billingPoints, cols);

  const orderTotal = orders.totalsByCol.reduce((s, v) => s + v, 0);
  const billingTotal = billing.totalsByCol.reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="売上・請求分析"
        subtitle="受注日ベースの月別受注額と、請求日ベースの月別請求額(売上)を分類別に分析します。"
        action={
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
            {fyOptions.map((o) => (
              <Link key={o.v} href={`/app/analytics/revenue?fy=${o.v}`} className={`rounded-lg px-2.5 py-1.5 font-medium ${o.v === fyParam ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink"}`}>
                {o.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="受注額(累計)" amount={orderTotal} accent sub="受注日ベース・受注済み" />
        <StatCard label="請求額(累計・予定込)" amount={billingTotal} sub="請求日ベース" />
        <StatCard label="受注行" raw={`${orderPoints.length}`} sub="受注済み案件" />
        <StatCard label="請求行(月展開)" raw={`${billingPoints.length}`} sub="毎月請求は月数ぶん" />
      </div>

      <Section title="月別 受注額(受注日ベース・分類別)">
        <StackedTrendChart data={orders.data} series={orders.series} />
        <CategoryLegend />
      </Section>

      <Section title="月別 請求額(請求日ベース・分類別)">
        <StackedTrendChart data={billing.data} series={billing.series} />
        <CategoryLegend />
      </Section>

      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]">
          <h2 className="section-title">月別 受注額 vs 請求額</h2>
        </div>
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">月</th>
              <th className="th text-right">受注額(受注日)</th>
              <th className="th text-right">請求額(請求日)</th>
              <th className="th text-right">差分</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {cols.map((c, i) => {
              const ord = orders.totalsByCol[i];
              const bil = billing.totalsByCol[i];
              if (ord === 0 && bil === 0) return null;
              return (
                <tr key={c.key} className="row-hover">
                  <td className="td font-medium">{c.label}</td>
                  <td className="td text-right tabular-nums stat-accent">{formatYen(ord)}</td>
                  <td className="td text-right tabular-nums text-teal-deep">{formatYen(bil)}</td>
                  <td className="td text-right tabular-nums text-ink/50">{formatYen(bil - ord)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-black/[0.08] bg-mist-soft/40 font-semibold">
              <td className="td">累計</td>
              <td className="td text-right tabular-nums stat-accent">{formatYen(orderTotal)}</td>
              <td className="td text-right tabular-nums text-teal-deep">{formatYen(billingTotal)}</td>
              <td className="td text-right tabular-nums text-ink/50">{formatYen(billingTotal - orderTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-ink/40 leading-relaxed">
        ※ 受注額は受注済み案件を<b>受注日</b>(受注予定日)で計上。請求額は案件の<b>請求スケジュール</b>を
        <b>請求日</b>で計上し、毎月請求(SES開発・顧問サブスク)は開始〜終了月まで月額を展開しています。
        受注済み案件には受注額をもとにした請求予定を初期投入済みで、案件詳細から実態に合わせて調整できます。
      </p>
    </div>
  );
}
