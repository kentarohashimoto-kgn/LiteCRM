import { listRevenueForecasts, getForecastYears } from "@/lib/data/revenue-forecast";
import { MoneyInput } from "@/components/ui/money-input";
import { saveRevenueForecastAction, deleteRevenueForecastAction } from "@/server/actions";
import { PageHeader, Card, Section } from "@/components/ui/primitives";
import { SubTabs } from "@/components/ui/sub-tabs";
import { FORECAST_TABS } from "@/components/forecast/forecast-nav";
import { FyTabs } from "@/components/dashboard/fy-tabs";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { RevenueForecastImport } from "@/components/forecast/revenue-forecast-import";
import { monthlySpread, bandOf, BAND_LABEL, BAND_COLOR, fyMonthKeys, type Band, type RevForecast } from "@/lib/revenue-forecast";
import { currentFiscalStartYear } from "@/lib/fiscal";
import { formatYen, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ForecastPipelinePage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const sp = await searchParams;
  const currentFy = currentFiscalStartYear(new Date());
  const dataYears = await getForecastYears();
  const years = Array.from(new Set([currentFy + 1, currentFy, ...dataYears])).sort((a, b) => b - a);
  const fyParam = parseInt(sp.fy ?? "", 10);
  const fy = Number.isFinite(fyParam) ? fyParam : (years[0] ?? currentFy + 1);

  const rows = await listRevenueForecasts(fy);

  const tot = rows.reduce((a, r) => {
    const amt = r.amount ?? 0, cost = r.cost ?? 0, p = r.probability ?? 0;
    return { amount: a.amount + amt, cost: a.cost + cost, weighted: a.weighted + amt * p };
  }, { amount: 0, cost: 0, weighted: 0 });
  const gross = tot.amount - tot.cost;

  // 確度band別
  const bands: Band[] = ["commit", "best", "pipeline", "upside"];
  const byBand = bands.map((b) => {
    const rs = rows.filter((r) => bandOf(r.probability) === b);
    return { b, count: rs.length, amount: rs.reduce((s, r) => s + (r.amount ?? 0), 0), weighted: rs.reduce((s, r) => s + (r.amount ?? 0) * (r.probability ?? 0), 0) };
  });

  // 月次(weighted/amount)
  const keys = fyMonthKeys(fy);
  const mAmt = new Map<string, number>(), mW = new Map<string, number>();
  let unscheduledW = 0;
  for (const r of rows) {
    for (const s of monthlySpread(r)) {
      if (!s.month) { unscheduledW += s.weighted; continue; }
      mAmt.set(s.month, (mAmt.get(s.month) ?? 0) + s.amount);
      mW.set(s.month, (mW.get(s.month) ?? 0) + s.weighted);
    }
  }
  const chart = keys.map((k) => ({ label: k.slice(5) + "月", value: Math.round(mW.get(k) ?? 0) }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="受注見込み（来期計画）"
        subtitle="案件ごとに期間・売上・確度を入力すると、確度で加重した月次の受注見込みが算出され、年度の着地計画になります。"
        action={<FyTabs years={years} selected={fy} currentFy={currentFy} />}
      />
      <SubTabs tabs={FORECAST_TABS} />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><div className="text-xs text-ink/50">見込件数</div><div className="text-2xl font-bold mt-1">{rows.length}</div></Card>
        <Card><div className="text-xs text-ink/50">売上予測(総額)</div><div className="text-lg font-bold mt-1 tabular-nums">{formatYen(tot.amount)}</div></Card>
        <Card><div className="text-xs text-ink/50">Weighted(確度加重)</div><div className="text-xl font-bold mt-1 tabular-nums stat-accent">{formatYen(Math.round(tot.weighted))}</div></Card>
        <Card><div className="text-xs text-ink/50">粗利予測</div><div className="text-lg font-bold mt-1 tabular-nums">{tot.cost > 0 ? formatYen(gross) : "原価未入力"}</div></Card>
        <Card><div className="text-xs text-ink/50">時期未定(Weighted)</div><div className="text-lg font-bold mt-1 tabular-nums">{formatYen(Math.round(unscheduledW))}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="月次 受注見込み（Weighted）" className="lg:col-span-2" action={<span className="text-[11px] text-ink/40">{fy}年度・確度加重</span>}>
          {chart.some((c) => c.value > 0) ? <SimpleBar data={chart} /> : <p className="text-sm text-ink/40 py-8 text-center">期間付きの見込みがありません。期間(例: 7月～8月)を入力すると月次に反映されます。</p>}
        </Section>
        <Section title="確度別サマリー">
          <div className="space-y-2">
            {byBand.map((x) => (
              <div key={x.b} className="flex items-center justify-between text-sm">
                <span className={cn("pill text-[11px] font-semibold", BAND_COLOR[x.b])}>{BAND_LABEL[x.b]}</span>
                <span className="tabular-nums text-ink/60">{x.count}件 / {formatYen(x.amount)}</span>
                <span className="tabular-nums font-semibold text-teal-deep">{formatYen(Math.round(x.weighted))}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <RevenueForecastImport defaultFy={fy} />

      {/* 一覧（編集可） */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-2 border-b border-black/[0.04] flex items-center justify-between">
          <h2 className="section-title">受注見込み一覧（{fy}年度）</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-ink/50">
            <tr><th className="th">確度</th><th className="th">顧客 / 案件</th><th className="th">商品</th><th className="th">期間</th><th className="th text-right">売上予測</th><th className="th text-right">確度</th><th className="th text-right">Weighted</th><th className="th">担当</th></tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <Rlow key={r.id} r={r} fy={fy} />
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="td text-center text-ink/40 py-8">この年度の見込みがありません。上のフォームから取込むか、下で追加してください。</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 追加 */}
      <Card>
        <div className="text-sm font-semibold mb-2">見込みを追加</div>
        <form action={saveRevenueForecastAction} className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input type="hidden" name="fy_start" value={fy} />
          <input name="account" placeholder="顧客 *" className="input text-sm" required />
          <input name="deal" placeholder="案件" className="input text-sm" />
          <input name="product" placeholder="商品(開発/SES/顧問/SaaS/研修)" className="input text-sm" />
          <input name="period" placeholder="期間(例: 7月～8月)" className="input text-sm" />
          <MoneyInput name="amount" placeholder="売上予測(円)" className="input text-sm" />
          <MoneyInput name="cost" placeholder="原価予測(円)" className="input text-sm" />
          <input name="prob" placeholder="確度(例: 50%)" className="input text-sm" />
          <input name="owner" placeholder="担当" className="input text-sm" />
          <input name="orderDate" placeholder="受注予定日(任意)" className="input text-sm" />
          <input name="memo" placeholder="メモ" className="input text-sm md:col-span-2" />
          <button className="btn-primary text-sm">追加</button>
        </form>
      </Card>

      <p className="text-xs text-ink/40">
        ※ Weighted＝売上予測×確度。月次は期間で均等割りして確度加重。確度90%以上=Commit/60-89%=Best/30-59%=Pipeline/30%未満=Upside。
        期間が空の見込みは「時期未定」に計上（受注予定日があればその月）。会計年度は7月開始。
      </p>
    </div>
  );
}

function Row_Weighted(r: RevForecast) { return Math.round((r.amount ?? 0) * (r.probability ?? 0)); }

function Rlow({ r, fy }: { r: RevForecast; fy: number }) {
  const band = bandOf(r.probability);
  return (
    <tr className="row-hover align-top">
      <td className="td"><span className={cn("pill text-[10px] font-bold", BAND_COLOR[band])}>{Math.round((r.probability ?? 0) * 100)}%</span></td>
      <td className="td max-w-[240px]">
        <details>
          <summary className="cursor-pointer font-medium">{r.account_name}<span className="block text-[11px] text-ink/45">{r.deal_name ?? ""}</span></summary>
          <form action={saveRevenueForecastAction} className="mt-2 grid grid-cols-2 gap-1.5 border-t border-black/[0.05] pt-2">
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="fy_start" value={fy} />
            <input name="account" defaultValue={r.account_name ?? ""} className="input text-xs" />
            <input name="deal" defaultValue={r.deal_name ?? ""} placeholder="案件" className="input text-xs" />
            <input name="product" defaultValue={r.product ?? ""} placeholder="商品" className="input text-xs" />
            <input name="period" defaultValue={r.period_label ?? ""} placeholder="期間" className="input text-xs" />
            <MoneyInput name="amount" defaultValue={r.amount ?? ""} placeholder="売上予測" className="input text-xs" />
            <MoneyInput name="cost" defaultValue={r.cost ?? ""} placeholder="原価" className="input text-xs" />
            <input name="prob" defaultValue={r.probability != null ? Math.round(r.probability * 100) + "%" : ""} placeholder="確度" className="input text-xs" />
            <input name="owner" defaultValue={r.owner ?? ""} placeholder="担当" className="input text-xs" />
            <input name="memo" defaultValue={r.memo ?? ""} placeholder="メモ" className="input text-xs col-span-2" />
            <button className="btn-primary text-xs col-span-2">保存</button>
          </form>
          <form action={deleteRevenueForecastAction} className="mt-1"><input type="hidden" name="id" value={r.id} /><button className="text-[11px] text-rose-400 hover:text-rose-600">削除</button></form>
        </details>
      </td>
      <td className="td text-xs">{r.product ?? "—"}</td>
      <td className="td text-xs whitespace-nowrap">{r.period_label ?? "—"}</td>
      <td className="td text-right tabular-nums">{formatYen(r.amount ?? 0)}</td>
      <td className="td text-right tabular-nums text-xs">{r.probability != null ? Math.round(r.probability * 100) + "%" : "—"}</td>
      <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(Row_Weighted(r))}</td>
      <td className="td text-xs">{r.owner ?? "—"}</td>
    </tr>
  );
}
