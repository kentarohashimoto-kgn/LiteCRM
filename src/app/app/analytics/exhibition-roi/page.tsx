import { getExhibitionBreakdown, getExhibitionDealRoi } from "@/lib/data/exhibition-analysis";
import { MoneyInput } from "@/components/ui/money-input";
import { saveExhibitionEventAction, saveDealDetailCostAction } from "@/server/actions";
import { PageHeader, Card, Section } from "@/components/ui/primitives";
import { SubTabs } from "@/components/ui/sub-tabs";
import { EXHIBITION_TABS } from "@/components/analytics/exhibition-nav";
import { ExhibitionChart } from "@/components/charts/exhibition-chart";
import { DealCostImport } from "@/components/analytics/deal-cost-import";
import { trendOf, groupBy, exhibitionLabel, fmtYm, TREND_LABEL, TREND_COLOR, type ExhibitionRow } from "@/lib/exhibition-analysis";
import { formatYen, formatPercent, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function roiPct(rev: number, cost: number): string {
  return cost > 0 ? formatPercent((rev - cost) / cost) : "—";
}

export default async function ExhibitionRoiPage() {
  // 時系列(右肩上がり判定)のため全期間を取得し、ym昇順で並ぶ
  const rows: ExhibitionRow[] = await getExhibitionBreakdown("2020-01-01", "2100-01-01");
  // 受注/売上/原価/ROI(案件の詳細=展示会/施策ラベル別)。受注は全期間。
  const dealRoi = await getExhibitionDealRoi("2020-01-01", "2100-01-01");
  const dealTot = dealRoi.reduce((a, r) => ({ deals: a.deals + r.deals, revenue: a.revenue + r.revenue, cost: a.cost + r.cost, open: a.open + r.open_amount }), { deals: 0, revenue: 0, cost: 0, open: 0 });

  const tot = rows.reduce(
    (a, r) => ({
      leads: a.leads + r.leads, appts: a.appts + r.appts, deals: a.deals + r.deals, revenue: a.revenue + r.revenue,
      cost: a.cost + (r.cost ?? 0), impNoAppt: a.impNoAppt + r.important_no_appt, nurture: a.nurture + r.nurture,
    }),
    { leads: 0, appts: 0, deals: 0, revenue: 0, cost: 0, impNoAppt: 0, nurture: 0 },
  );
  // 掘り起こし優先(未アポの重要リードが多い展示会)
  const digTop = [...rows].filter((r) => r.important_no_appt > 0).sort((a, b) => b.important_no_appt - a.important_no_appt).slice(0, 6);
  const digMax = digTop.length ? digTop[0].important_no_appt : 1;
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
      <SubTabs tabs={EXHIBITION_TABS} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><div className="text-xs text-ink/50">展示会数</div><div className="text-2xl font-bold mt-1">{rows.length}</div></Card>
        <Card><div className="text-xs text-ink/50">総リード</div><div className="text-xl font-bold mt-1 tabular-nums">{tot.leads.toLocaleString()}</div></Card>
        <Card><div className="text-xs text-ink/50">総アポ</div><div className="text-xl font-bold mt-1 tabular-nums">{tot.appts.toLocaleString()}<span className="text-xs text-ink/40 ml-1">{tot.leads > 0 ? formatPercent(tot.appts / tot.leads) : ""}</span></div></Card>
        <Card><div className="text-xs text-ink/50">受注 / 受注額(CRM)</div><div className="text-lg font-bold mt-1 tabular-nums stat-accent">{dealTot.deals}件 {formatYen(dealTot.revenue)}</div></Card>
        <Card className="border-rose-200 bg-rose-50/40"><div className="text-xs text-rose-600 font-semibold">掘り起こし対象(重要・未アポ)</div><div className="text-2xl font-bold mt-1 tabular-nums text-rose-600">{tot.impNoAppt.toLocaleString()}</div><div className="text-[10px] text-ink/45">重要リードのうち未アポ</div></Card>
        <Card className="border-amber-200 bg-amber-50/40"><div className="text-xs text-amber-700 font-semibold">ナーチャリング母数(未アポ全体)</div><div className="text-2xl font-bold mt-1 tabular-nums text-amber-700">{tot.nurture.toLocaleString()}</div></Card>
        <Card><div className="text-xs text-ink/50">出展費用</div><div className="text-lg font-bold mt-1 tabular-nums">{tot.cost > 0 ? formatYen(tot.cost) : "未入力"}</div></Card>
        <Card><div className="text-xs text-ink/50">受注率(受注/アポ)</div><div className="text-xl font-bold mt-1 tabular-nums">{tot.appts > 0 ? formatPercent(tot.deals / tot.appts) : "—"}</div></Card>
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

      {/* 掘り起こし優先(未アポの重要リードが多い展示会) */}
      {digTop.length > 0 && (
        <Section title="掘り起こし優先 — 未アポの重要リードが多い展示会" action={<span className="text-[11px] text-ink/40">重要=ランクS/A・大企業・決裁層</span>}>
          <div className="space-y-2">
            {digTop.map((r) => (
              <div key={r.raw_event} className="flex items-center gap-3">
                <span className="w-44 truncate text-sm">{fmtYm(r.ym)} {r.label}</span>
                <div className="flex-1 h-3 rounded-full bg-mist-soft overflow-hidden">
                  <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.max(3, (r.important_no_appt / digMax) * 100)}%` }} />
                </div>
                <span className="w-28 text-right text-sm font-semibold tabular-nums text-rose-600">{r.important_no_appt}件 未アポ</span>
                <span className="w-20 text-right text-[11px] text-ink/45">重要{r.important}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink/45 mt-2">※ これらは過去に名刺交換済みだが未アポの重要顧客。架電・ナーチャリングの再アプローチ候補です。</p>
        </Section>
      )}

      {/* 展示会以外の施策別 受注・ROI(代理店/セミナー/紹介 等。展示会はYYYYMM行に統合済) */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04] flex items-center justify-between gap-3">
          <div>
            <h2 className="section-title">展示会以外の施策別 受注・ROI（代理店/セミナー/紹介 等）</h2>
            <p className="text-[11px] text-ink/40 mt-0.5">展示会(YYYYMM)は上の一覧に統合済。ここは案件の「詳細」のうち展示会以外。原価入力でROI＝(売上−原価)/原価。</p>
          </div>
          <DealCostImport />
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-ink/50">
            <tr><th className="th">施策(詳細)</th><th className="th text-right">受注</th><th className="th text-right">受注売上</th><th className="th text-right">商談中</th><th className="th text-right">原価(費用)</th><th className="th text-right">粗利</th><th className="th text-right">ROI</th></tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {dealRoi.filter((dr) => !rows.some((er) => er.raw_event === dr.detail)).map((r) => {
              const gross = r.revenue - r.cost;
              const roi = r.cost > 0 ? (r.revenue - r.cost) / r.cost : null;
              return (
                <tr key={r.detail} className="row-hover">
                  <td className="td font-medium max-w-[260px] truncate" title={r.detail}>{r.detail}</td>
                  <td className="td text-right tabular-nums font-semibold">{r.deals}</td>
                  <td className="td text-right tabular-nums stat-accent">{formatYen(r.revenue)}</td>
                  <td className="td text-right tabular-nums text-xs text-ink/60">{r.open_deals}件 / {formatYen(r.open_amount)}</td>
                  <td className="td text-right">
                    <form action={saveDealDetailCostAction} className="flex items-center gap-1 justify-end">
                      <input type="hidden" name="detail" value={r.detail} />
                      <MoneyInput name="cost" defaultValue={r.cost || ""} placeholder="原価" className="input text-xs w-24 py-0.5 text-right" />
                      <button className="btn-ghost text-[11px] py-0.5 px-2">保存</button>
                    </form>
                  </td>
                  <td className="td text-right tabular-nums text-xs">{r.cost > 0 ? formatYen(gross) : "—"}</td>
                  <td className={cn("td text-right tabular-nums font-bold", roi != null && roi >= 1 ? "text-teal-deep" : roi != null && roi < 0 ? "text-rose-600" : "")}>{roi != null ? formatPercent(roi) : "—"}</td>
                </tr>
              );
            })}
            {dealRoi.length === 0 && <tr><td colSpan={7} className="td text-center text-ink/40 py-8">案件に詳細(展示会/施策)が紐づいていません。商談取込で「詳細」列を取り込むと表示されます。</td></tr>}
          </tbody>
        </table>
      </div>

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
              <th className="th text-right">リード</th><th className="th text-right">アポ</th>
              <th className="th text-right text-rose-600">掘(重要未アポ)</th><th className="th text-right text-amber-700">ナ(未アポ計)</th>
              <th className="th text-right">受注</th><th className="th text-right">受注額</th><th className="th text-right">費用</th><th className="th text-right">CPL</th><th className="th text-right">ROI</th>
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
                      <MoneyInput name="cost" defaultValue={r.cost ?? ""} placeholder="出展費用(円)" className="input text-xs col-span-2" />
                      <button className="btn-primary text-xs col-span-2">保存</button>
                    </form>
                  </details>
                </td>
                <td className="td text-xs"><div>{r.organizer ?? "—"}</div><div className="text-ink/45">{r.theme ?? "—"}</div></td>
                <td className="td text-right tabular-nums">{r.leads.toLocaleString()}</td>
                <td className="td text-right tabular-nums">{r.appts}</td>
                <td className="td text-right tabular-nums font-semibold text-rose-600">{r.important_no_appt}</td>
                <td className="td text-right tabular-nums text-amber-700">{r.nurture}</td>
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
        ※ リードは展示会別リード(raw_event=YYYYMM_展示会名)の実データ。
        <b>アポは案件基準</b>（その展示会由来の案件件数＝アポ獲得数。リードのアポ決着数の方が多い場合はそちらを採用）。受注・売上は紐付く案件の受注実績(CRM)。
        傾向は古い→新しい順の伸び(線形回帰)で判定。主催会社・テーマは各展示会にタグ付けすると比較(ばらつき分析)できます。費用入力でCPL・ROIが算出されます。
      </p>
    </div>
  );
}

function BreakdownTable({ groups, emptyHint }: { groups: import("@/lib/exhibition-analysis").GroupAgg[]; emptyHint: string }) {
  const real = groups.filter((g) => g.key !== "未設定");
  if (real.length === 0) return <p className="text-sm text-ink/40 py-6 text-center">{emptyHint}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-ink/50"><tr><th className="th text-left">区分</th><th className="th text-right">展示会</th><th className="th text-right">リード</th><th className="th text-right">アポ</th><th className="th text-right text-rose-600">掘</th><th className="th text-right">受注</th><th className="th text-right">売上</th><th className="th text-right">CPL</th><th className="th text-right">ROI</th></tr></thead>
        <tbody className="divide-y divide-black/[0.04]">
          {groups.map((g) => (
            <tr key={g.key} className={cn(g.key === "未設定" && "text-ink/40")}>
              <td className="td font-medium">{g.key}</td>
              <td className="td text-right tabular-nums">{g.count}</td>
              <td className="td text-right tabular-nums">{g.leads.toLocaleString()}</td>
              <td className="td text-right tabular-nums">{g.appts}</td>
              <td className="td text-right tabular-nums text-rose-600">{g.important_no_appt}</td>
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
