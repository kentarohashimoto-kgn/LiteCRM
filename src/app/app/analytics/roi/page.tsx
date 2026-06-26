import { Fragment } from "react";
import Link from "next/link";
import { getChannelRoi, listMarketingChannels, listChannelCosts, getRoiFiscalYears } from "@/lib/data/roi";
import { saveChannelAction, deleteChannelAction, saveChannelCostAction } from "@/server/actions";
import { PageHeader, Card } from "@/components/ui/primitives";
import { FyTabs } from "@/components/dashboard/fy-tabs";
import { JUDGE_COLOR, JUDGE_LABEL, CHANNEL_CATEGORIES, CHANNEL_KINDS, TARGET_LEVELS, roiPct, pct, type ChannelRoiRow } from "@/lib/roi";
import { currentFiscalStartYear } from "@/lib/fiscal";
import { formatYen, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");

export default async function ChannelRoiPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const currentFy = currentFiscalStartYear(now);
  const years = await getRoiFiscalYears(currentFy);
  const fyParam = parseInt(sp.fy ?? "", 10);
  const fy = Number.isFinite(fyParam) && years.includes(fyParam) ? fyParam : currentFy;
  const start = `${fy}-07-01`;
  const end = `${fy + 1}-07-01`;

  const [rows, channels, costs] = await Promise.all([
    getChannelRoi(start, end),
    listMarketingChannels(),
    listChannelCosts(start, end),
  ]);

  const tot = rows.reduce(
    (a, r) => ({
      cost: a.cost + r.cost, revenue: a.revenue + r.revenue, profit: a.profit + r.profit,
      deals: a.deals + r.deals, leads: a.leads + r.leads,
    }),
    { cost: 0, revenue: 0, profit: 0, deals: 0, leads: 0 },
  );
  const overallRoi = tot.cost > 0 ? (tot.profit - tot.cost) / tot.cost : null;
  const anyRevenueBasis = rows.some((r) => r.profitBasis === "revenue" && r.revenue > 0);
  const uncosted = rows.filter((r) => r.cost <= 0 && (r.revenue > 0 || r.leads > 0)).length;

  // コスト入力の既定月(対象年度の当月、年度外なら年度開始月)
  const curMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const inFy = curMonth >= `${fy}-07` && curMonth <= `${fy + 1}-06`;
  const defaultMonth = inFy ? curMonth : `${fy}-07`;
  const costByChannel = new Map<string, typeof costs>();
  for (const c of costs) {
    const arr = costByChannel.get(c.channel_id) ?? [];
    arr.push(c);
    costByChannel.set(c.channel_id, arr);
  }

  // マインドマップのカテゴリ単位でグルーピング(＋小計)
  const CAT_ORDER = ["展示会", "セミナー", "代理店", "顧問", "アポ代行", "マッチング", "交流会・イベント", "広告", "オーガニック", "紹介", "自社営業", "その他"];
  const byCat = new Map<string, ChannelRoiRow[]>();
  for (const r of rows) {
    const k = r.category || "その他";
    const arr = byCat.get(k) ?? [];
    arr.push(r);
    byCat.set(k, arr);
  }
  const cats = Array.from(byCat.keys()).sort(
    (a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
  const catSubtotal = (rs: ChannelRoiRow[]) =>
    rs.reduce((a, r) => ({
      cost: a.cost + r.cost, leads: a.leads + r.leads, appts: a.appts + r.appts,
      deals: a.deals + r.deals, revenue: a.revenue + r.revenue, profit: a.profit + r.profit, open_deals: a.open_deals + r.open_deals,
    }), { cost: 0, leads: 0, appts: 0, deals: 0, revenue: 0, profit: 0, open_deals: 0 });

  return (
    <div>
      <PageHeader
        title="施策ROI分析"
        subtitle="流入元・施策ごとのコスト/獲得/受注/ROIを集計。増資(Good)・改善(Watch)・撤退検討(Bad)を色分けで判断します。"
        action={<FyTabs years={years} selected={fy} currentFy={currentFy} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">施策コスト計</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(tot.cost)}</div></Card>
        <Card><div className="text-xs text-ink/50">受注売上計</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(tot.revenue)}</div></Card>
        <Card><div className="text-xs text-ink/50">{anyRevenueBasis ? "粗利(暫定)" : "粗利"}計</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(tot.profit)}</div></Card>
        <Card><div className="text-xs text-ink/50">全体ROI</div><div className={cn("text-2xl font-bold mt-1", overallRoi != null && overallRoi >= 2 ? "text-teal-deep" : "stat-accent")}>{roiPct(overallRoi)}</div></Card>
        <Card><div className="text-xs text-ink/50">受注件数</div><div className="text-2xl font-bold mt-1">{tot.deals}</div></Card>
      </div>

      {(anyRevenueBasis || uncosted > 0) && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800">
          {anyRevenueBasis && <span>※ 粗利(原価)未入力の施策は<strong>売上ベースの暫定ROI</strong>で表示しています（Phase2で商品原価を入力すると粗利ベースに切替）。</span>}
          {uncosted > 0 && <span className="block">※ コスト未入力の施策が <strong>{uncosted}件</strong> あります。各行の「コスト入力」から月次コストを登録するとROIが算出されます。</span>}
        </div>
      )}

      <div className="card overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead className="border-b border-black/[0.06] text-ink/50">
            <tr>
              <th className="th">判定</th><th className="th">施策 / カテゴリ</th>
              <th className="th text-right">コスト</th><th className="th text-right">リード</th><th className="th text-right">アポ</th>
              <th className="th text-right">受注</th><th className="th text-right">売上</th><th className="th text-right">CAC</th>
              <th className="th text-right">ROI</th><th className="th text-right">L→A</th><th className="th text-right">A→受注</th>
              <th className="th text-right">商談中</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {cats.map((cat) => {
              const crs = byCat.get(cat) ?? [];
              const st = catSubtotal(crs);
              const stRoi = st.cost > 0 ? (st.profit - st.cost) / st.cost : null;
              return (
              <Fragment key={cat}>
              <tr className="bg-mist-soft/50">
                <td className="td"></td>
                <td className="td font-bold text-ink/70">
                  {cat}
                  {cat === "展示会" && <Link href="/app/analytics/exhibition-roi" className="ml-2 text-[11px] font-normal text-teal-primary hover:underline">展示会別の時系列・主催・テーマ分析 →</Link>}
                </td>
                <td className="td text-right tabular-nums font-semibold">{st.cost > 0 ? formatYen(st.cost) : "—"}</td>
                <td className="td text-right tabular-nums font-semibold">{st.leads.toLocaleString()}</td>
                <td className="td text-right tabular-nums font-semibold">{st.appts.toLocaleString()}</td>
                <td className="td text-right tabular-nums font-semibold">{st.deals}</td>
                <td className="td text-right tabular-nums font-semibold">{formatYen(st.revenue)}</td>
                <td className="td"></td>
                <td className={cn("td text-right tabular-nums font-bold", stRoi != null && stRoi >= 2 ? "text-teal-deep" : "")}>{roiPct(stRoi)}</td>
                <td className="td"></td><td className="td"></td>
                <td className="td text-right tabular-nums text-xs">{st.open_deals}件</td>
              </tr>
              {crs.map((r) => {
              const chCosts = costByChannel.get(r.id) ?? [];
              return (
                <tr key={r.id} className="row-hover align-top">
                  <td className="td"><span className={cn("pill text-[11px] font-bold whitespace-nowrap", JUDGE_COLOR[r.judge])}>{JUDGE_LABEL[r.judge]}</span></td>
                  <td className="td max-w-[230px]">
                    <details>
                      <summary className="cursor-pointer font-medium">
                        {r.priority && <span className="text-rose-500 mr-1">❗</span>}{r.name}
                        <span className="block text-[11px] text-ink/45">{r.category}{r.committed_qty ? ` ・約束${r.committed_qty}${r.committed_metric === "appointments" ? "アポ/月" : ""}` : ""}</span>
                      </summary>
                      {/* コスト入力 */}
                      <form action={saveChannelCostAction} className="mt-2 border-t border-black/[0.05] pt-2 grid grid-cols-2 gap-1.5">
                        <input type="hidden" name="channel_id" value={r.id} />
                        <div className="col-span-2 text-[11px] font-semibold text-ink/55">月次コスト入力</div>
                        <input name="month" type="month" defaultValue={defaultMonth} className="input text-xs" />
                        <input name="fixed_cost" type="number" placeholder="固定費" className="input text-xs" />
                        <input name="variable_cost" type="number" placeholder="変動費(成果報酬)" className="input text-xs" />
                        <input name="result_qty" type="number" placeholder="実績量(例:実アポ数)" className="input text-xs" />
                        <input name="memo" placeholder="メモ" className="input text-xs col-span-2" />
                        <button className="btn-accent text-xs col-span-2">コストを保存</button>
                      </form>
                      {chCosts.length > 0 && (
                        <div className="mt-1.5 text-[10px] text-ink/45">
                          入力済: {chCosts.map((c) => `${c.month.slice(0, 7)}=${formatYen((c.fixed_cost ?? 0) + (c.variable_cost ?? 0))}`).join(" / ")}
                        </div>
                      )}
                      {/* マスタ編集 */}
                      <form action={saveChannelAction} className="mt-2 border-t border-black/[0.05] pt-2 grid grid-cols-2 gap-1.5">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="name" defaultValue={r.name} className="input text-xs" />
                        <select name="category" defaultValue={r.category ?? ""} className="input text-xs">{CHANNEL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                        <select name="kind" defaultValue={r.kind ?? "other"} className="input text-xs">{CHANNEL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
                        <select name="target_level" defaultValue={r.target_level ?? ""} className="input text-xs"><option value="">対象レベル</option>{TARGET_LEVELS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                        <select name="committed_metric" defaultValue={r.committed_metric ?? ""} className="input text-xs"><option value="">コミット指標</option><option value="appointments">アポ</option><option value="leads">リード</option></select>
                        <input name="committed_qty" type="number" defaultValue={r.committed_qty ?? ""} placeholder="コミット量/月" className="input text-xs" />
                        <label className="flex items-center gap-1 text-xs col-span-2"><input type="checkbox" name="priority_flag" value="1" defaultChecked={r.priority} className="accent-teal-primary" />重点施策</label>
                        <button className="btn-primary text-xs col-span-2">施策を更新</button>
                      </form>
                      <form action={deleteChannelAction} className="mt-1"><input type="hidden" name="id" value={r.id} /><button className="text-[11px] text-rose-400 hover:text-rose-600">この施策を削除</button></form>
                    </details>
                  </td>
                  <td className="td text-right tabular-nums">{r.cost > 0 ? formatYen(r.cost) : "—"}</td>
                  <td className="td text-right tabular-nums">{r.leads.toLocaleString()}</td>
                  <td className="td text-right tabular-nums">{r.appts.toLocaleString()}</td>
                  <td className="td text-right tabular-nums font-semibold">{r.deals}</td>
                  <td className="td text-right tabular-nums">{formatYen(r.revenue)}</td>
                  <td className="td text-right tabular-nums text-xs">{r.cac != null ? formatYen(r.cac) : "—"}</td>
                  <td className={cn("td text-right tabular-nums font-bold", r.roi != null && r.roi >= 2 ? "text-teal-deep" : r.roi != null && r.roi < 0.5 ? "text-rose-600" : "")}>{roiPct(r.roi)}</td>
                  <td className="td text-right tabular-nums text-xs">{pct(r.leadToAppt)}</td>
                  <td className="td text-right tabular-nums text-xs">{pct(r.apptToDeal)}</td>
                  <td className="td text-right tabular-nums text-xs">{r.open_deals}件 / {formatYen(r.open_amount)}</td>
                </tr>
              );
            })}
              </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={12} className="td text-center text-ink/40 py-8">施策がありません。下のフォームから登録してください。</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 施策マスタ追加 */}
      <Card>
        <div className="text-sm font-semibold mb-2">施策を追加</div>
        <form action={saveChannelAction} className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input name="name" placeholder="施策名 *(例: ライトアップ)" className="input text-sm md:col-span-2" required />
          <select name="category" defaultValue="その他" className="input text-sm">{CHANNEL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select name="kind" defaultValue="other" className="input text-sm">{CHANNEL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          <select name="target_level" defaultValue="" className="input text-sm"><option value="">対象レベル</option>{TARGET_LEVELS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <select name="committed_metric" defaultValue="" className="input text-sm"><option value="">コミット指標</option><option value="appointments">アポ</option><option value="leads">リード</option></select>
          <input name="committed_qty" type="number" placeholder="コミット量/月" className="input text-sm" />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="priority_flag" value="1" className="accent-teal-primary" />重点</label>
          <button className="btn-primary text-sm md:col-span-4">施策を登録</button>
        </form>
      </Card>

      <p className="text-xs text-ink/40 mt-3">
        ※ ROI＝(粗利−コスト)/コスト。判定しきい値(仮): Good ROI≥200% / Watch ≥50% / Bad &lt;50%。アトリビューションはファーストタッチ(流入元)。
        受注・売上は対象年度内(7月〜翌6月)の受注予定月で集計、商談中(パイプライン)は現在値です。
      </p>
    </div>
  );
}
