import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { getSalesTargets, listOpportunities, listBillingSchedules } from "@/lib/data/select";
import { getLeadMetrics } from "@/lib/data/leads";
import { PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { ForecastTabs, type WonRow, type PipelineRow, type InputRow } from "@/components/forecast/forecast-tabs";
import { buildSubscriptionForecast } from "@/lib/subscription";
import { listRevenueForecasts } from "@/lib/data/revenue-forecast";
import { monthlySpread, bandOf } from "@/lib/revenue-forecast";
import { STAGE_MAP } from "@/lib/constants";
import { currentFiscalStartYear, fiscalMonths, fiscalYearLabel } from "@/lib/fiscal";
import { actualByMonth } from "@/lib/targets";
import { monthKey, startOfMonth, formatYen, formatPercent, sum } from "@/lib/utils";
import type { OppView } from "@/lib/data/select";

function revMonthKey(o: OppView): string | null {
  const ref = o.expected_revenue_month || o.expected_close_date;
  return ref ? monthKey(startOfMonth(new Date(ref))) : null;
}

function yomiTier(yomi?: string): "A" | "B" | "C" | "other" {
  if (!yomi) return "other";
  if (yomi.startsWith("1.A")) return "A";
  if (yomi.startsWith("2.B")) return "B";
  if (yomi.startsWith("3.C")) return "C";
  return "other";
}

function daysBetween(end?: string | null, start?: string | null): number | null {
  if (!end || !start) return null;
  return Math.round((+new Date(end) - +new Date(start)) / 86400000);
}

export default async function ForecastPage({ searchParams }: { searchParams: { fy?: string } }) {
  const ws = await getWorkspace();
  const cur = currentFiscalStartYear();
  const fy = searchParams.fy ? parseInt(searchParams.fy, 10) : cur;
  const months = fiscalMonths(fy);
  const fyOptions = [cur - 1, cur, cur + 1];

  const opps = listOpportunities(ws);
  const targets = getSalesTargets(ws);
  const targetMap = new Map(targets.map((t) => [t.target_month, t]));
  const actuals = actualByMonth(opps, (await getLeadMetrics(opps)).byMonth);

  // ===== 受注見込み(来期計画)を月次・確度加重で合算 =====
  const plans = await listRevenueForecasts(fy);
  const planByMonth = new Map<string, { commit: number; best: number; pipeline: number; weighted: number }>();
  for (const p of plans) {
    for (const s of monthlySpread(p)) {
      if (!s.month) continue;
      const k = s.month + "-01";
      const b = planByMonth.get(k) ?? { commit: 0, best: 0, pipeline: 0, weighted: 0 };
      const band = bandOf(p.probability);
      if (band === "commit") b.commit += s.amount;
      else if (band === "best") b.best += s.amount;
      else b.pipeline += s.amount; // pipeline/upside
      b.weighted += s.weighted;
      planByMonth.set(k, b);
    }
  }

  const rows = months.map((m) => {
    const t = targetMap.get(m.key);
    const a = actuals.get(m.key);
    const inMonth = opps.filter((o) => revMonthKey(o) === m.key);
    const open = inMonth.filter((o) => o.status === "open");
    const won = sum(inMonth.filter((o) => o.status === "won"), (o) => o.amount);
    const pl = planByMonth.get(m.key) ?? { commit: 0, best: 0, pipeline: 0, weighted: 0 };
    const commit = sum(open.filter((o) => o.forecast_category === "commit"), (o) => o.amount) + won + pl.commit;
    const best = commit + sum(open.filter((o) => o.forecast_category === "best_case"), (o) => o.amount) + pl.best;
    const pipeline = sum(open.filter((o) => o.forecast_category === "pipeline"), (o) => o.amount) + pl.pipeline;
    const weighted = sum(open, (o) => o.weighted) + won + pl.weighted;
    const planWeighted = pl.weighted;
    return {
      key: m.key,
      label: m.label,
      target: t?.target_amount ?? 0,
      targetDeals: t?.target_deals ?? 0,
      targetAppts: t?.target_appointments ?? 0,
      targetLeads: t?.target_leads ?? 0,
      revenue: a?.revenue ?? 0,
      deals: a?.deals ?? 0,
      appts: a?.appts ?? 0,
      leads: a?.leads ?? 0,
      commit,
      best,
      pipeline,
      weighted,
      planWeighted,
    };
  });
  const totPlanWeighted = sum(rows, (r) => r.planWeighted);

  const tot = {
    target: sum(rows, (r) => r.target),
    revenue: sum(rows, (r) => r.revenue),
    targetDeals: sum(rows, (r) => r.targetDeals),
    deals: sum(rows, (r) => r.deals),
    targetAppts: sum(rows, (r) => r.targetAppts),
    appts: sum(rows, (r) => r.appts),
    targetLeads: sum(rows, (r) => r.targetLeads),
    leads: sum(rows, (r) => r.leads),
  };
  const rate = (a: number, t: number) => (t > 0 ? a / t : null);

  // ===== 受注一覧(選択年度内に受注計上された案件) =====
  const monthSet = new Set(months.map((m) => m.key));
  const wonRows: WonRow[] = opps
    .filter((o) => o.status === "won" && revMonthKey(o) && monthSet.has(revMonthKey(o)!))
    .map((o) => ({
      id: o.id,
      date: o.expected_close_date ?? o.expected_revenue_month ?? null,
      account: o.account?.name ?? "—",
      name: o.name,
      amount: o.amount,
      owner: o.owner?.name ?? "",
      days: daysBetween(o.expected_close_date, o.first_meeting_date),
      source: o.leadSource?.name ?? "",
      sourceDetail: o.campaign?.name ?? "",
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // ===== 受注見込み(オープン案件のヨミ別) =====
  const openOpps = opps.filter((o) => o.status === "open");
  const pipelineRows: PipelineRow[] = openOpps.map((o) => ({
    id: o.id,
    account: o.account?.name ?? "—",
    name: o.name,
    amount: o.amount,
    tier: yomiTier(o.yomi),
    yomiLabel: o.yomi ?? "—",
    expectedClose: o.expected_close_date ?? null,
    repProbability: o.rep_probability ?? null,
  }));

  // ===== 予測入力(オープン案件) =====
  const inputRows: InputRow[] = openOpps.map((o) => ({
    id: o.id,
    account: o.account?.name ?? "—",
    name: o.name,
    amount: o.amount,
    expectedClose: o.expected_close_date ?? null,
    repProbability: o.rep_probability ?? null,
    yomi: o.yomi ?? "",
    stageLabel: STAGE_MAP[o.stage]?.label ?? o.stage,
  }));

  // ===== 継続売上(サブスク) =====
  const { monthly: subMonthly, subs } = buildSubscriptionForecast(opps, listBillingSchedules(ws), months);

  const monthly = (
    <>
      {/* 年度KPI: 4指標の実績/目標 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="売上(実績/目標)" amount={tot.revenue} accent sub={`目標 ${formatYen(tot.target)}・達成 ${formatPercent(rate(tot.revenue, tot.target))}`} />
        <StatCard label="成約(実績/目標)" raw={`${tot.deals}`} sub={`目標 ${tot.targetDeals}・達成 ${formatPercent(rate(tot.deals, tot.targetDeals))}`} />
        <StatCard label="アポ(実績/目標)" raw={`${tot.appts}`} sub={`目標 ${tot.targetAppts}・達成 ${formatPercent(rate(tot.appts, tot.targetAppts))}`} />
        <StatCard label="受注見込み(計画・加重)" raw={formatYen(Math.round(totPlanWeighted))} sub={totPlanWeighted > 0 ? "売上予測に合算済" : "受注見込みシート未取込"} />
      </div>

      <Section title={`月別 売上予測（${fiscalYearLabel(fy)}）`} className="mb-5">
        <ForecastChart
          data={rows.map((b) => ({
            label: b.label,
            commit: b.commit,
            bestCase: Math.max(0, b.best - b.commit),
            pipeline: b.pipeline,
            weighted: b.weighted,
            target: b.target,
          }))}
        />
      </Section>

      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]">
          <h2 className="section-title">月別 目標 vs 実績</h2>
        </div>
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">月</th>
              <th className="th text-right">売上実績</th>
              <th className="th text-right">売上目標</th>
              <th className="th text-right">達成率</th>
              <th className="th text-right">成約 実/目</th>
              <th className="th text-right">アポ 実/目</th>
              <th className="th text-right">リード 実/目</th>
              <th className="th text-right">受注見込み(計画・加重)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => {
              const ra = rate(r.revenue, r.target);
              return (
                <tr key={r.key} className="row-hover">
                  <td className="td font-medium whitespace-nowrap">{r.label}</td>
                  <td className="td text-right tabular-nums stat-accent">{formatYen(r.revenue)}</td>
                  <td className="td text-right tabular-nums text-ink/60">{formatYen(r.target)}</td>
                  <td className={`td text-right tabular-nums font-medium ${ra != null && ra >= 1 ? "text-teal-deep" : "text-ink/50"}`}>{formatPercent(ra)}</td>
                  <td className="td text-right tabular-nums">{r.deals} / {r.targetDeals}</td>
                  <td className="td text-right tabular-nums">{r.appts} / {r.targetAppts}</td>
                  <td className="td text-right tabular-nums">{r.leads} / {r.targetLeads}</td>
                  <td className="td text-right tabular-nums text-teal-deep">{r.planWeighted > 0 ? formatYen(Math.round(r.planWeighted)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-black/[0.08] bg-mist-soft/40 font-semibold">
              <td className="td">年度計</td>
              <td className="td text-right tabular-nums stat-accent">{formatYen(tot.revenue)}</td>
              <td className="td text-right tabular-nums text-ink/60">{formatYen(tot.target)}</td>
              <td className="td text-right tabular-nums">{formatPercent(rate(tot.revenue, tot.target))}</td>
              <td className="td text-right tabular-nums">{tot.deals} / {tot.targetDeals}</td>
              <td className="td text-right tabular-nums">{tot.appts} / {tot.targetAppts}</td>
              <td className="td text-right tabular-nums">{tot.leads} / {tot.targetLeads}</td>
              <td className="td text-right tabular-nums text-teal-deep">{formatYen(Math.round(totPlanWeighted))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-ink/40 mt-3">
        ※ 目標は<Link href="/app/targets" className="text-teal-primary hover:underline">目標入力</Link>で設定。
        実績=売上/成約は受注日、アポは初回商談日、リードはリード獲得日ベース。
      </p>
    </>
  );

  return (
    <div>
      <PageHeader
        title="売上予測"
        subtitle={`${fiscalYearLabel(fy)}（${fy}年7月〜${fy + 1}年6月）の目標と着地見込み。weighted = 金額 × 確度。`}
        action={
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
            {fyOptions.map((y) => (
              <Link key={y} href={`/app/forecast?fy=${y}`} className={`rounded-lg px-3 py-1.5 font-medium ${y === fy ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink"}`}>
                {fiscalYearLabel(y)}
              </Link>
            ))}
          </div>
        }
      />

      <ForecastTabs monthly={monthly} won={wonRows} pipeline={pipelineRows} inputs={inputRows} subMonthly={subMonthly} subs={subs} />
    </div>
  );
}
