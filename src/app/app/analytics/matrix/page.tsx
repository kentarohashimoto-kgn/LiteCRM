import { getChannelLevelMatrix, type MatrixCell } from "@/lib/data/matrix";
import { getRoiFiscalYears } from "@/lib/data/roi";
import { PageHeader, Card } from "@/components/ui/primitives";
import { FyTabs } from "@/components/dashboard/fy-tabs";
import { SIZE_BANDS } from "@/lib/customer-level";
import { currentFiscalStartYear } from "@/lib/fiscal";
import { formatYen, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EMPTY: MatrixCell = { leads: 0, deals: 0, revenue: 0 };

export default async function MatrixPage({ searchParams }: { searchParams: Promise<{ fy?: string; metric?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const currentFy = currentFiscalStartYear(now);
  const years = await getRoiFiscalYears(currentFy);
  const fyParam = parseInt(sp.fy ?? "", 10);
  const fy = Number.isFinite(fyParam) && years.includes(fyParam) ? fyParam : currentFy;
  const metric = sp.metric === "leads" ? "leads" : "revenue";
  const start = `${fy}-07-01`;
  const end = `${fy + 1}-07-01`;

  const rows = await getChannelLevelMatrix(start, end);

  const val = (c: MatrixCell | undefined) => (c ? c[metric] : 0);
  const maxVal = Math.max(1, ...rows.flatMap((r) => SIZE_BANDS.map((b) => val(r.cells[b.key]))));

  // 列(レベル)合計
  const bandTotals = SIZE_BANDS.map((b) => {
    const t = rows.reduce((a, r) => {
      const c = r.cells[b.key] ?? EMPTY;
      return { leads: a.leads + c.leads, deals: a.deals + c.deals, revenue: a.revenue + c.revenue };
    }, { leads: 0, deals: 0, revenue: 0 });
    return { ...b, ...t, avgDeal: t.deals > 0 ? t.revenue / t.deals : 0 };
  });
  // 重点候補: 売上が最大 かつ 平均単価が高い規模帯(不明は除外)
  const ranked = bandTotals.filter((b) => b.key !== "unknown" && (b.revenue > 0 || b.leads > 0));
  const topByRevenue = [...ranked].sort((a, b) => b.revenue - a.revenue)[0];
  const topByAvg = [...ranked].sort((a, b) => b.avgDeal - a.avgDeal)[0];

  const cellBg = (v: number) => (v <= 0 ? undefined : `rgba(0,140,140,${0.08 + 0.5 * (v / maxVal)})`);
  const fmt = (c: MatrixCell | undefined) => (metric === "revenue" ? formatYen(c?.revenue ?? 0) : `${c?.leads ?? 0}件`);

  return (
    <div>
      <PageHeader
        title="施策 × 顧客レベル クロス分析"
        subtitle="どの施策が・どのレベルの顧客を獲得/受注しているかを可視化。重点ターゲット(規模帯)と、それに効く施策を選定します。"
        action={<FyTabs years={years} selected={fy} currentFy={currentFy} />}
      />

      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className="text-ink/50">表示指標:</span>
        <a href={`/app/analytics/matrix?fy=${fy}&metric=revenue`} className={cn("rounded-lg px-3 py-1 font-medium", metric === "revenue" ? "bg-teal-primary text-white" : "border border-black/10 text-ink/60")}>受注売上</a>
        <a href={`/app/analytics/matrix?fy=${fy}&metric=leads`} className={cn("rounded-lg px-3 py-1 font-medium", metric === "leads" ? "bg-teal-primary text-white" : "border border-black/10 text-ink/60")}>獲得リード</a>
      </div>

      {/* 重点ターゲット示唆 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <Card>
          <div className="text-xs text-ink/50">売上が最大の規模帯</div>
          <div className="text-lg font-bold mt-1">{topByRevenue ? topByRevenue.short : "—"}</div>
          {topByRevenue && <div className="text-xs text-ink/50">受注 {formatYen(topByRevenue.revenue)} / {topByRevenue.deals}件</div>}
        </Card>
        <Card>
          <div className="text-xs text-ink/50">平均単価が最も高い規模帯(LTV目安)</div>
          <div className="text-lg font-bold mt-1 stat-accent">{topByAvg ? topByAvg.short : "—"}</div>
          {topByAvg && <div className="text-xs text-ink/50">平均 {formatYen(topByAvg.avgDeal)}/件</div>}
        </Card>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-ink/50">
            <tr>
              <th className="th text-left">施策 \ 規模帯</th>
              {SIZE_BANDS.map((b) => <th key={b.key} className="th text-right">{b.short}</th>)}
              <th className="th text-right">合計</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => {
              const rowTotal = SIZE_BANDS.reduce((s, b) => s + val(r.cells[b.key]), 0);
              return (
                <tr key={r.id} className="row-hover">
                  <td className="td"><span className="font-medium">{r.name}</span><span className="block text-[10px] text-ink/40">{r.category}</span></td>
                  {SIZE_BANDS.map((b) => {
                    const c = r.cells[b.key];
                    return (
                      <td key={b.key} className="td text-right tabular-nums" style={{ backgroundColor: cellBg(val(c)) }}>
                        {val(c) > 0 ? (
                          <>
                            <div className="font-semibold">{fmt(c)}</div>
                            <div className="text-[10px] text-ink/45">{c?.leads ?? 0}L / {c?.deals ?? 0}受</div>
                          </>
                        ) : <span className="text-ink/25">—</span>}
                      </td>
                    );
                  })}
                  <td className="td text-right tabular-nums font-bold">{metric === "revenue" ? formatYen(rowTotal) : `${rowTotal}件`}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={SIZE_BANDS.length + 2} className="td text-center text-ink/40 py-8">データがありません。</td></tr>}
          </tbody>
          <tfoot className="border-t border-black/[0.08] bg-mist-soft/40">
            <tr>
              <td className="td font-semibold">合計</td>
              {bandTotals.map((b) => (
                <td key={b.key} className="td text-right tabular-nums font-semibold">
                  {metric === "revenue" ? formatYen(b.revenue) : `${b.leads}件`}
                  <div className="text-[10px] text-ink/45 font-normal">{b.deals}受 / 平均{formatYen(b.avgDeal)}</div>
                </td>
              ))}
              <td className="td"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-ink/40 mt-3">
        ※ 規模帯は従業員規模から判定(エンプラ=1000名〜/中堅=100〜1000/SMB=〜100)。獲得リードは取得月、受注は受注予定月で対象年度内を集計。
        受注の規模帯は由来リードの規模に基づくため、リード紐付けの無い直接商談は「不明」になります。セル={metric === "revenue" ? "受注売上" : "獲得リード"}（濃いほど大）、L=リード/受=受注。
      </p>
      <p className="text-xs text-ink/40">
        重点ターゲットの決め方: 「売上が大きい × 平均単価(LTV目安)が高い」規模帯を狙い、その列で数字の濃い施策に重点配分します。
      </p>
    </div>
  );
}
