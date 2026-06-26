import { getExhibitionBreakdown } from "@/lib/data/exhibition-analysis";
import { saveExhibitionEventAction } from "@/server/actions";
import { PageHeader, Card, Section } from "@/components/ui/primitives";
import { ExhibitionChart } from "@/components/charts/exhibition-chart";
import { trendOf, groupBy, exhibitionLabel, fmtYm, TREND_LABEL, TREND_COLOR, type ExhibitionRow } from "@/lib/exhibition-analysis";
import { formatYen, formatPercent, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function roiPct(rev: number, cost: number): string {
  return cost > 0 ? formatPercent((rev - cost) / cost) : "—";
}

export default async function ExhibitionRoiPage() {
  // 時系列(右肩上がり判定)のため全期間を取得し、ym昇順で並ぶ
  const rows: ExhibitionRow[] = await getExhibitionBreakdown("2020-01-01", "2100-01-01");

  const tot = rows.reduce(
    (a, r) => ({ leads: a.leads + r.leads, appts: a.appts + r.appts, deals: a.deals + r.deals, revenue: a.revenue + r.revenue, cost: a.cost + (r.cost ?? 0) }),
    { leads: 0, appts: 0, deals: 0, revenue: 0, cost: 0 },
  );
  const leadTrend = trendOf(rows.map((r) => r.leads));
  const revTrend = trendOf(rows.map((r) => r.revenue));
  const apptTrend = trendOf(rows.map((r) => r.appts));

  const byOrganizer = groupBy(rows, (r) => r.organizer);
  const byTheme = groupBy(rows, (r) => r.theme);
  const taggedOrg = rows.filter((r) => r.organizer).length;
  const taggedTheme = rows.filter((r) => r.theme).length;

  const chartData = rows.map((r) => ({ label: exhibitionLabel(r).slice(0, 14), revenue: r.revenue, leads: r.leads }));
  const desc = [...rows].reverse();

  return (
    <div className="space-y-5">
      <PageHeader
        title="展示会分析（時系列・主催・テーマ）"
        subtitle="リード取込の展示会別データ(YYYYMM_展示会名)を時系列で集計。右肩上がり傾向か、主催会社・テーマでばらつきが無いかを分析します。"
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><div className="text-xs text-ink/50">展示会数</div><div className="text-2xl font-bold mt-1">{rows.length}</div></Card>
        <Card><div className="text-xs text-ink/50">総リード</div><div className="text-xl font-bold mt-1 tabular-nums">{tot.leads.toLocaleString()}</div></Card>
        <Card><div className="text-xs text-ink/50">総アポ</div><div className="text-xl font-bold mt-1 tabular-nums">{tot.appts.toLocaleString()}</div></Card>
        <Card><div className="text-xs text-ink/50">受注(CRM)</div><div className="text-xl font-bold mt-1 tabular-nums">{tot.deals}</div></Card>
        <Card><div className="text-xs text-ink/50">売上(CRM)</div><div className="text-lg font-bold mt-1 tabular-nums stat-accent">{formatYen(tot.revenue)}</div></Card>
        <Card><div className="text-xs text-ink/50">出展費用</div><div className="text-lg font-bold mt-1 tabular-nums">{tot.cost > 0 ? formatYen(tot.cost) : "未入力"}</div></Card>
      </div>

      {/* 傾向サマリー */}
      <Section title="成果の傾向（時系列）" action={<span className="text-[11px] text-ink/40">古い→新しい順の伸び</span>}>
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="text-sm text-ink/60">リード:</span><span className={cn("pill text-xs font-bold", TREND_COLOR[leadTrend])}>{TREND_LABEL[leadTrend]}</span>
          <span className="text-sm text-ink/60 ml-3">アポ:</span><span className={cn("pill text-xs font-bold", TREND_COLOR[apptTrend])}>{TREND_LABEL[apptTrend]}</span>
          <span className="text-sm text-ink/60 ml-3">売上:</span><span className={cn("pill text-xs font-bold", TREND_COLOR[revTrend])}>{TREND_LABEL[revTrend]}</span>
        </div>
        {chartData.length ? <ExhibitionChart data={chartData} /> : <p className="text-sm text-ink/40 py-6 text-center">データがありません</p>}
      </Section>

      {/* 主催会社別・テーマ別 ばらつき */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="主催会社別" action={<span className="text-[11px] text-ink/40">タグ済 {taggedOrg}/{rows.length}</span>}>
          <BreakdownTable groups={byOrganizer} emptyHint="各展示会に主催会社をタグ付けすると比較できます" />
        </Section>
        <Section title="テーマ別" action={<span className="text-[11px] text-ink/40">タグ済 {taggedTheme}/{rows.length}</span>}>
          <BreakdownTable groups={byTheme} emptyHint="各展示会にテーマをタグ付けすると比較できます" />
        </Section>
      </div>

      {/* 展示会別 一覧(時系列・新しい順) + 主催/テーマ/費用のタグ付け */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]"><h2 className="section-title">展示会別 実績（新しい順／主催・テーマ・費用を編集）</h2></div>
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-ink/50">
            <tr>
              <th className="th">展示会(YYYYMM)</th><th className="th">主催 / テーマ</th>
              <th className="th text-right">リード</th><th className="th text-right">アポ</th><th className="th text-right">受注</th>
              <th className="th text-right">売上</th><th className="th text-right">費用</th><th className="th text-right">CPL</th><th className="th text-right">ROI</th>
              <th className="th text-right">L→A</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {desc.map((r) => (
              <tr key={r.raw_event} className="row-hover align-top">
                <td className="td max-w-[230px]">
                  <details>
                    <summary className="cursor-pointer font-medium">{fmtYm(r.ym)} <span className="text-ink/70">{r.label ?? r.raw_event}</span></summary>
                    <form action={saveExhibitionEventAction} className="mt-2 border-t border-black/[0.05] pt-2 grid grid-cols-2 gap-1.5">
                      <input type="hidden" name="raw_event" value={r.raw_event} />
                      <input name="label" defaultValue={r.label ?? ""} placeholder="展示会名" className="input text-xs col-span-2" />
                      <input name="organizer" defaultValue={r.organizer ?? ""} placeholder="主催会社" className="input text-xs" />
                      <input name="theme" defaultValue={r.theme ?? ""} placeholder="テーマ(例:AI/DX/総務)" className="input text-xs" />
                      <input name="cost" type="number" defaultValue={r.cost ?? ""} placeholder="出展費用(円)" className="input text-xs col-span-2" />
                      <button className="btn-primary text-xs col-span-2">保存</button>
                    </form>
                  </details>
                </td>
                <td className="td text-xs"><div>{r.organizer ?? "—"}</div><div className="text-ink/45">{r.theme ?? "—"}</div></td>
                <td className="td text-right tabular-nums">{r.leads.toLocaleString()}</td>
                <td className="td text-right tabular-nums">{r.appts}</td>
                <td className="td text-right tabular-nums font-semibold">{r.deals}</td>
                <td className="td text-right tabular-nums stat-accent">{formatYen(r.revenue)}</td>
                <td className="td text-right tabular-nums text-xs">{r.cost != null ? formatYen(r.cost) : "—"}</td>
                <td className="td text-right tabular-nums text-xs">{r.cost && r.leads > 0 ? formatYen(r.cost / r.leads) : "—"}</td>
                <td className="td text-right tabular-nums text-xs">{roiPct(r.revenue, r.cost ?? 0)}</td>
                <td className="td text-right tabular-nums text-xs">{r.leads > 0 ? formatPercent(r.appts / r.leads) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="td text-center text-ink/40 py-8">展示会リードがありません。</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/40 leading-relaxed">
        ※ リード・アポは展示会別リード(raw_event=YYYYMM_展示会名)の実データ、受注・売上は紐付く案件の受注実績(CRM)。
        傾向は古い→新しい順の伸び(線形回帰)で判定。主催会社・テーマは各展示会にタグ付けすると比較(ばらつき分析)できます。費用入力でCPL・ROIが算出されます。
      </p>
    </div>
  );
}

function BreakdownTable({ groups, emptyHint }: { groups: { key: string; count: number; leads: number; appts: number; deals: number; revenue: number; cost: number; cpl: number | null; roi: number | null }[]; emptyHint: string }) {
  const real = groups.filter((g) => g.key !== "未設定");
  if (real.length === 0) return <p className="text-sm text-ink/40 py-6 text-center">{emptyHint}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-ink/50"><tr><th className="th text-left">区分</th><th className="th text-right">展示会数</th><th className="th text-right">リード</th><th className="th text-right">アポ</th><th className="th text-right">受注</th><th className="th text-right">売上</th><th className="th text-right">CPL</th><th className="th text-right">ROI</th></tr></thead>
        <tbody className="divide-y divide-black/[0.04]">
          {groups.map((g) => (
            <tr key={g.key} className={cn(g.key === "未設定" && "text-ink/40")}>
              <td className="td font-medium">{g.key}</td>
              <td className="td text-right tabular-nums">{g.count}</td>
              <td className="td text-right tabular-nums">{g.leads.toLocaleString()}</td>
              <td className="td text-right tabular-nums">{g.appts}</td>
              <td className="td text-right tabular-nums">{g.deals}</td>
              <td className="td text-right tabular-nums">{formatYen(g.revenue)}</td>
              <td className="td text-right tabular-nums">{g.cpl != null ? formatYen(g.cpl) : "—"}</td>
              <td className="td text-right tabular-nums">{g.roi != null ? formatPercent(g.roi) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
