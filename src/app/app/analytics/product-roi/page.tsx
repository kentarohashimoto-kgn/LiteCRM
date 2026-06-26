import { getProductProfitability, getSubscriptionMetrics, listSubscriptions } from "@/lib/data/product-roi";
import { getRoiFiscalYears } from "@/lib/data/roi";
import { saveProductMetaAction, cancelSubscriptionAction } from "@/server/actions";
import { PageHeader, Card, Section } from "@/components/ui/primitives";
import { FyTabs } from "@/components/dashboard/fy-tabs";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { PRODUCT_JUDGE_COLOR, PRODUCT_JUDGE_LABEL, PRODUCT_TYPES, marginPct } from "@/lib/product-roi";
import { currentFiscalStartYear } from "@/lib/fiscal";
import { formatYen, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProductRoiPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const currentFy = currentFiscalStartYear(now);
  const years = await getRoiFiscalYears(currentFy);
  const fyParam = parseInt(sp.fy ?? "", 10);
  const fy = Number.isFinite(fyParam) && years.includes(fyParam) ? fyParam : currentFy;
  const start = `${fy}-07-01`;
  const end = `${fy + 1}-07-01`;

  const [rows, subMonths, subs] = await Promise.all([
    getProductProfitability(start, end),
    getSubscriptionMetrics(start, end),
    listSubscriptions(),
  ]);

  const tot = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, profit: a.profit + r.profit, deals: a.deals + r.deals }), { revenue: 0, profit: 0, deals: 0 });
  const avgMargin = tot.revenue > 0 ? tot.profit / tot.revenue : null;
  const latestMrr = subMonths.length ? subMonths[subMonths.length - 1].mrr : 0;
  const churnTotal = subMonths.reduce((s, m) => s + m.churn_mrr, 0);
  const activeSubs = subs.filter((s) => s.sub_status !== "canceled");
  const anyRevenueBasis = rows.some((r) => r.profitBasis === "revenue" && r.revenue > 0);

  return (
    <div>
      <PageHeader
        title="プロダクト収益分析"
        subtitle="商品ごとの売上・粗利・粗利率と、サブスクのMRR/解約を集計。集中(売れ筋×高粗利)・改善・撤退を判断します。"
        action={<FyTabs years={years} selected={fy} currentFy={currentFy} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">受注売上計</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(tot.revenue)}</div></Card>
        <Card><div className="text-xs text-ink/50">{anyRevenueBasis ? "粗利(暫定)" : "粗利"}計</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(tot.profit)}</div></Card>
        <Card><div className="text-xs text-ink/50">平均粗利率</div><div className="text-2xl font-bold mt-1 stat-accent">{marginPct(avgMargin)}</div></Card>
        <Card><div className="text-xs text-ink/50">MRR(最新月)</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(latestMrr)}</div></Card>
        <Card><div className="text-xs text-ink/50">解約(年度計)</div><div className="text-xl font-bold mt-1 tabular-nums text-rose-600">{formatYen(churnTotal)}</div></Card>
      </div>

      {anyRevenueBasis && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800">
          ※ 原価/粗利率が未設定の商品は<strong>売上を粗利として暫定表示</strong>しています。各行の編集で<strong>原価 または 粗利率</strong>を入力すると、粗利率・収益性判定が有効になります。
        </div>
      )}

      <div className="card overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-ink/50">
            <tr>
              <th className="th">判定</th><th className="th">商品 / カテゴリ</th><th className="th">タイプ</th>
              <th className="th text-right">受注</th><th className="th text-right">売上</th>
              <th className="th text-right">粗利</th><th className="th text-right">粗利率</th><th className="th text-right">商談中</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <tr key={r.id} className="row-hover align-top">
                <td className="td"><span className={cn("pill text-[11px] font-bold whitespace-nowrap", PRODUCT_JUDGE_COLOR[r.judge])}>{PRODUCT_JUDGE_LABEL[r.judge]}</span></td>
                <td className="td max-w-[230px]">
                  <details>
                    <summary className="cursor-pointer font-medium">
                      {r.priority && <span className="text-rose-500 mr-1">❗</span>}{r.name}
                      <span className="block text-[11px] text-ink/45">{r.category}{r.is_recurring ? " ・継続課金" : ""}</span>
                    </summary>
                    <form action={saveProductMetaAction} className="mt-2 border-t border-black/[0.05] pt-2 grid grid-cols-2 gap-1.5">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="product_type" defaultValue={r.product_type ?? ""} className="input text-xs"><option value="">タイプ</option>{PRODUCT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                      <input name="default_gross_profit_rate" type="number" step="0.01" defaultValue={r.gp_rate ?? ""} placeholder="粗利率(%) 例:50" className="input text-xs" />
                      <input name="unit_cost" type="number" defaultValue={r.unit_cost ?? ""} placeholder="標準原価(円)" className="input text-xs" />
                      <input name="delivery_hours" type="number" placeholder="ﾃﾞﾘﾊﾞﾘｰ工数(h)" className="input text-xs" />
                      <label className="flex items-center gap-1 text-xs col-span-2"><input type="checkbox" name="priority_flag" value="1" defaultChecked={r.priority} className="accent-teal-primary" />重点商品</label>
                      <button className="btn-primary text-xs col-span-2">原価/粗利を保存</button>
                    </form>
                  </details>
                </td>
                <td className="td text-xs">{PRODUCT_TYPES.find((t) => t.key === r.product_type)?.label ?? "—"}</td>
                <td className="td text-right tabular-nums font-semibold">{r.deals}</td>
                <td className="td text-right tabular-nums">{formatYen(r.revenue)}</td>
                <td className="td text-right tabular-nums text-xs">{formatYen(r.profit)}</td>
                <td className={cn("td text-right tabular-nums font-bold", r.margin != null && r.margin >= 0.5 ? "text-teal-deep" : r.margin != null && r.margin < 0.3 ? "text-rose-600" : "")}>{marginPct(r.margin)}</td>
                <td className="td text-right tabular-nums text-xs">{r.open_deals}件 / {formatYen(r.open_amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="td text-center text-ink/40 py-8">商品がありません。</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="サブスク MRR 推移">
          {subMonths.some((m) => m.mrr > 0) ? (
            <SimpleBar data={subMonths.map((m) => ({ label: m.month.slice(5), value: m.mrr }))} />
          ) : (
            <p className="text-sm text-ink/40 py-8 text-center">継続課金データがありません（請求で継続課金を登録すると集計されます）。</p>
          )}
        </Section>
        <Section title="サブスク契約（解約は手動入力）" action={<span className="pill bg-teal-light text-teal-deep">{activeSubs.length}件 稼働</span>}>
          <div className="space-y-2 max-h-[360px] overflow-y-auto">
            {subs.map((s) => (
              <div key={s.id} className={cn("rounded-lg border px-3 py-2 text-xs", s.sub_status === "canceled" ? "border-rose-200 bg-rose-50/40 opacity-70" : "border-black/10")}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.account_name ?? "—"}</span>
                  <span className="tabular-nums">{formatYen(s.amount)}/月</span>
                </div>
                <div className="text-[10px] text-ink/45">{s.recurring_start_month?.slice(0, 7) ?? "—"}〜{s.recurring_end_month?.slice(0, 7) ?? ""} {s.sub_status === "canceled" && `／解約:${s.canceled_month?.slice(0, 7) ?? ""}`}</div>
                <form action={cancelSubscriptionAction} className="mt-1 flex items-center gap-1">
                  <input type="hidden" name="id" value={s.id} />
                  <input name="canceled_month" type="month" defaultValue={s.canceled_month?.slice(0, 7) ?? ""} className="input text-[11px] py-0.5" title="解約月(空で解約取消)" />
                  <input name="cancel_reason" defaultValue={s.cancel_reason ?? ""} placeholder="解約理由" className="input text-[11px] py-0.5 flex-1" />
                  <button className="btn-ghost text-[11px] py-0.5 px-2">保存</button>
                </form>
              </div>
            ))}
            {subs.length === 0 && <p className="text-sm text-ink/40 py-6 text-center">継続課金の契約がありません。</p>}
          </div>
        </Section>
      </div>

      <p className="text-xs text-ink/40 mt-3">
        ※ 売上・粗利は対象年度内(7月〜翌6月)の受注予定月で集計。粗利は案件の粗利、無ければ商品の粗利率→売上の順で暫定。
        サブスクMRRは継続課金(recurring)の有効契約から算出し、解約は手動入力(解約月)を反映します。判定しきい値(仮): 粗利率≥50%集中 / ≥30%改善。
      </p>
    </div>
  );
}
