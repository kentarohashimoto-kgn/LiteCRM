import { getWorkspace } from "@/lib/data/workspace";
import { listOpportunities, listCampaignsByChannel } from "@/lib/data/select";
import { campaignMetrics, campaignTotals, type CampaignMetric } from "@/lib/analytics";
import { PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { ExhibitionChart } from "@/components/charts/exhibition-chart";
import { formatYen, formatPercent, formatDateFull } from "@/lib/utils";

function num(v: number | null | undefined): string {
  return v == null ? "—" : Math.round(v).toLocaleString("ja-JP");
}

export default async function ExhibitionAnalyticsPage() {
  const ws = await getWorkspace();
  const opps = listOpportunities(ws);
  const exhibitions = listCampaignsByChannel(ws, "exhibition");
  const metrics = campaignMetrics(exhibitions, opps);

  const done = metrics
    .filter((m) => m.campaign.event_status === "done")
    .sort((a, b) => (a.campaign.event_date ?? "").localeCompare(b.campaign.event_date ?? ""));
  const future = metrics
    .filter((m) => m.campaign.event_status !== "done")
    .sort((a, b) => (a.campaign.event_date ?? "").localeCompare(b.campaign.event_date ?? ""));

  const totals = campaignTotals(done);

  const chartData = done
    .filter((m) => m.campaign.event_date)
    .map((m) => ({
      label: m.campaign.name.length > 10 ? m.campaign.name.slice(0, 10) + "…" : m.campaign.name,
      revenue: m.wonAmount,
      leads: m.actualLeads ?? 0,
    }));

  // 費用対効果ランキング(費用が登録され成約のある実施済み)
  const roiRank = [...done]
    .filter((m) => m.roi != null)
    .sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0));

  return (
    <div className="space-y-5">
      <PageHeader
        title="展示会分析"
        subtitle="最重点のリード獲得施策。展示会ごとのリード→アポ→成約→売上とCPL/CPA/CPO/ROIを分析します。"
      />

      {/* 累計KPI(実施済み) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="総リード獲得" raw={num(totals.leads)} sub={`実施済み ${totals.count}件`} />
        <StatCard label="総アポ獲得" raw={num(totals.appointments)} sub={`アポ率 ${formatPercent(totals.leads ? totals.appointments / totals.leads : null)}`} />
        <StatCard label="成約(CRM)" raw={num(totals.wonCount)} sub={`紐付き商談 ${num(totals.oppCount)}件`} />
        <StatCard label="売上(CRM)" amount={totals.wonAmount} accent sub={`進行中Weighted ${formatYen(totals.weighted)}`} />
        <StatCard label="総出展費用" amount={totals.cost} sub="リード獲得費用" />
        <StatCard label="平均CPL" raw={totals.cpl != null ? formatYen(totals.cpl) : "—"} sub="リード単価" />
        <StatCard label="平均CPA" raw={totals.cpa != null ? formatYen(totals.cpa) : "—"} sub="アポ単価" />
        <StatCard label="ROI(売上/費用)" raw={formatPercent(totals.roi)} accent sub={`CPO ${totals.cpo != null ? formatYen(totals.cpo) : "—"}`} />
      </div>

      <Section title="展示会別 売上(CRM)とリード数">
        {chartData.length ? (
          <ExhibitionChart data={chartData} />
        ) : (
          <p className="text-sm text-ink/40 py-6 text-center">データがありません</p>
        )}
      </Section>

      {/* 過去展示会の実績 */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]">
          <h2 className="section-title">実施済み展示会の実績</h2>
        </div>
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">展示会 / 運営元</th>
              <th className="th">開催日</th>
              <th className="th text-right">リード</th>
              <th className="th text-right">アポ</th>
              <th className="th text-right">成約</th>
              <th className="th text-right">売上(CRM)</th>
              <th className="th text-right">費用</th>
              <th className="th text-right">CPL</th>
              <th className="th text-right">CPA</th>
              <th className="th text-right">CPO</th>
              <th className="th text-right">ROI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {[...done].reverse().map((m) => (
              <ExhibitionRow key={m.campaign.id} m={m} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-black/[0.08] bg-mist-soft/40 font-semibold">
              <td className="td" colSpan={2}>累計({totals.count}件)</td>
              <td className="td text-right tabular-nums">{num(totals.leads)}</td>
              <td className="td text-right tabular-nums">{num(totals.appointments)}</td>
              <td className="td text-right tabular-nums">{num(totals.wonCount)}</td>
              <td className="td text-right tabular-nums stat-accent">{formatYen(totals.wonAmount)}</td>
              <td className="td text-right tabular-nums">{formatYen(totals.cost)}</td>
              <td className="td text-right tabular-nums">{totals.cpl != null ? formatYen(totals.cpl) : "—"}</td>
              <td className="td text-right tabular-nums">{totals.cpa != null ? formatYen(totals.cpa) : "—"}</td>
              <td className="td text-right tabular-nums">{totals.cpo != null ? formatYen(totals.cpo) : "—"}</td>
              <td className="td text-right tabular-nums">{formatPercent(totals.roi)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 費用対効果ランキング */}
      {roiRank.length > 0 && (
        <Section title="費用対効果(ROI)ランキング">
          <div className="space-y-2">
            {roiRank.slice(0, 8).map((m, i) => {
              const max = roiRank[0].roi ?? 1;
              const pct = max > 0 ? Math.max(2, ((m.roi ?? 0) / max) * 100) : 0;
              return (
                <div key={m.campaign.id} className="flex items-center gap-3">
                  <span className="w-5 text-xs text-ink/40 tabular-nums">{i + 1}</span>
                  <span className="w-48 truncate text-sm">{m.campaign.name}</span>
                  <div className="flex-1 h-3 rounded-full bg-mist-soft overflow-hidden">
                    <div className="h-full rounded-full bg-teal-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums text-teal-deep">{formatPercent(m.roi)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* 今後の展示会(見込み) */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]">
          <h2 className="section-title">今後の展示会(申込み済・予定)</h2>
        </div>
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">展示会 / 運営元</th>
              <th className="th">会場</th>
              <th className="th">開催予定</th>
              <th className="th text-right">見込リード</th>
              <th className="th text-right">予定費用</th>
              <th className="th">メモ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {future.map((m) => (
              <tr key={m.campaign.id} className="row-hover">
                <td className="td">
                  <span className="font-medium text-ink block">{m.campaign.name}</span>
                  <span className="text-xs text-ink/45">{m.campaign.organizer ?? "—"}</span>
                </td>
                <td className="td text-xs text-ink/70">{m.campaign.venue ?? "—"}</td>
                <td className="td text-xs">
                  {formatDateFull(m.campaign.event_date)}
                  <span className="ml-1 pill bg-mist-soft text-ink/50 text-[10px]">
                    {m.campaign.event_status === "applied" ? "申込み済" : "予定"}
                  </span>
                </td>
                <td className="td text-right tabular-nums">{num(m.expectedLeads)}</td>
                <td className="td text-right tabular-nums">{m.cost != null ? formatYen(m.cost) : "—"}</td>
                <td className="td text-xs text-ink/55 max-w-[220px] truncate">{m.campaign.notes ?? "—"}</td>
              </tr>
            ))}
            {future.length === 0 && (
              <tr><td colSpan={6} className="td text-center text-ink/40 py-8">予定された展示会がありません</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/40 leading-relaxed">
        ※ <b>成約数・売上</b>は CRM の商談データを正本に集計（紐付き商談の受注実績）。
        <b>リード数・アポ数・費用</b>は展示会管理表の実績値。
        既存商談の展示会への紐付けは作成日からの<b>自動推定</b>（商談詳細で修正可）。
        括弧内の「表」は管理表の記載値（参考）。
      </p>
    </div>
  );
}

function ExhibitionRow({ m }: { m: CampaignMetric }) {
  const c = m.campaign;
  const reportedDiff =
    c.reported_revenue != null && c.reported_revenue !== m.wonAmount
      ? `表 ${formatYen(c.reported_revenue)}`
      : null;
  return (
    <tr className="row-hover">
      <td className="td max-w-[220px]">
        <span className="font-medium text-ink block truncate">{c.name}</span>
        <span className="text-xs text-ink/45">{c.organizer ?? "—"}</span>
      </td>
      <td className="td text-xs whitespace-nowrap">{formatDateFull(c.event_date)}</td>
      <td className="td text-right tabular-nums">{num(m.actualLeads)}</td>
      <td className="td text-right tabular-nums">{num(m.appointments)}</td>
      <td className="td text-right tabular-nums font-semibold">
        {m.wonCount}
        <span className="text-[10px] text-ink/35 font-normal"> / {m.oppCount}</span>
      </td>
      <td className="td text-right tabular-nums font-semibold stat-accent">
        {formatYen(m.wonAmount)}
        {reportedDiff && <span className="block text-[10px] text-ink/30 font-normal">{reportedDiff}</span>}
      </td>
      <td className="td text-right tabular-nums text-ink/70">{m.cost != null ? formatYen(m.cost) : "—"}</td>
      <td className="td text-right tabular-nums text-ink/70">{m.cpl != null ? formatYen(m.cpl) : "—"}</td>
      <td className="td text-right tabular-nums text-ink/70">{m.cpa != null ? formatYen(m.cpa) : "—"}</td>
      <td className="td text-right tabular-nums text-ink/70">{m.cpo != null ? formatYen(m.cpo) : "—"}</td>
      <td className="td text-right tabular-nums font-medium">
        <span className={m.roi != null && m.roi >= 1 ? "text-teal-deep" : m.roi != null && m.roi < 0 ? "text-rose-500" : "text-ink/50"}>
          {formatPercent(m.roi)}
        </span>
      </td>
    </tr>
  );
}
