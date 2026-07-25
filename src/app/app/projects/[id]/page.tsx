import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Lock, Trash2 } from "lucide-react";
import { getWorkspaceForOpportunity } from "@/lib/data/workspace";
import { getOpportunity, getUser, listMembers } from "@/lib/data/select";
import { requireProjectCtx } from "@/lib/session";
import { getProjectBundle, computeProject, monthRange, monthKey, type ProjAssignment, type CostMonth } from "@/lib/data/projects";
import { getForecastsForOpportunity } from "@/lib/data/forecasts";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { ProjectRevenueForm } from "@/components/projects/project-revenue-form";
import { ProjectAssignmentForm } from "@/components/projects/project-assignment-form";
import { ProjectWeeklyForm } from "@/components/projects/project-weekly-form";
import {
  enableProjectManagementAction, disableProjectManagementAction, updateProjectPlanAction,
  lockBaselineAction, deleteAssignmentAction, deleteWeeklyReportAction,
} from "@/server/actions/projects";
import { costVariance } from "@/lib/project-cost";
import { getApprovedWorkByPlan } from "@/lib/data/work-log";
import { hoursToCost, formatHoursHM } from "@/lib/work-time";
import { formatYen, formatPercent, formatDateFull } from "@/lib/utils";
import { DocumentSection } from "@/components/documents/document-section";

export const dynamic = "force-dynamic";

const ymLabel = (m: string) => (m ? `${m.split("-")[0]}/${Number(m.split("-")[1])}` : "—");
const ymLabelMonth = (d: string | null) => (d ? `${d.slice(0, 4)}/${Number(d.slice(5, 7))}` : "—");
const VERDICT = {
  go: { label: "GO", cls: "bg-emerald-50 text-emerald-700" },
  conditional: { label: "条件付き", cls: "bg-amber-50 text-amber-700" },
  review: { label: "要協議", cls: "bg-rose-50 text-rose-600" },
} as const;
const rateCls = (r: number) => (r >= 0.4 ? "text-emerald-600" : r >= 0.25 ? "text-amber-600" : "text-rose-600");

export default async function ProjectDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { saved?: string } }) {
  await requireProjectCtx();
  const ws = await getWorkspaceForOpportunity(params.id);
  const o = getOpportunity(ws, params.id);
  if (!o) notFound();
  const members = listMembers(ws).map(({ user }) => user);
  const bundle = await getProjectBundle(params.id);

  // 計画未作成: 案件管理対象化のCTA(見込み管理中ならその内容も表示)
  if (!bundle) {
    const oppForecasts = await getForecastsForOpportunity(o.id);
    return (
      <div>
        <BackLink id={o.id} />
        <PageHeader title={o.account?.name ?? "案件"} subtitle={`${o.name}｜案件管理`} />
        {oppForecasts.length > 0 && (
          <Card className="max-w-xl mb-4 border-violet-200 bg-violet-50/40">
            <div className="text-sm font-semibold text-violet-700 mb-2">📈 この案件は見込み管理中です</div>
            {oppForecasts.map((f) => (
              <div key={f.id} className="text-sm text-ink/70 space-y-0.5 mb-2">
                <div className="font-medium text-ink/85">{f.title}</div>
                <div className="text-xs text-ink/55">
                  期間 {f.startMonth ? `${f.startMonth.replace("-", "/")}〜${f.endMonth?.replace("-", "/") ?? ""}` : "未設定"}
                  ・{f.amountBasis === "monthly" ? `月額 ${formatYen(f.monthlyAmount)}` : `総額 ${formatYen(f.totalAmount)}`}
                  ・確度 {f.probability}%・必要 {f.requiredHeadcount || 0}名
                  {f.arrangeDeadline && <span className="text-rose-600">・調整期限 {f.arrangeDeadline}</span>}
                </div>
              </div>
            ))}
            <p className="text-xs text-ink/45">見込みの期間・金額・人員の編集は、カレンダーの「見込み」バッジ(✎)から行えます。</p>
          </Card>
        )}
        <Card className="max-w-xl">
          <p className="text-sm text-ink/70 mb-4">この案件はまだ<b>案件管理対象</b>になっていません。対象にすると、月別の販売・原価・粗利を管理し、提案可否や受注後の予実を追えます。{oppForecasts.length > 0 && <>受注したら対象化すると、<b>見込みの期間が計画に引き継がれます</b>。</>}</p>
          <form action={enableProjectManagementAction}>
            <input type="hidden" name="opportunity_id" value={o.id} />
            <SubmitButton className="btn-accent" pendingLabel="準備中…">案件管理を開始する</SubmitButton>
          </form>
        </Card>
      </div>
    );
  }

  const { plan, revenues, assignments, costMonths, weekly } = bundle;
  const { roll, verdict, room } = computeProject(bundle);
  const { byAssignmentMonth } = await getApprovedWorkByPlan([plan.id]);
  const seedMonths = monthRange(plan.start_month, plan.end_month);
  const months = roll.months.map((m) => m.month);

  // アサイン×月: 表示用(原価)＋編集用(生の工数/稼働率)
  const costByAsgMonth = new Map<string, Map<string, number>>();
  const cmByAsg = new Map<string, CostMonth[]>();
  for (const c of costMonths) {
    const inner = costByAsgMonth.get(c.assignment_id) ?? new Map<string, number>();
    inner.set(monthKey(c.month), Number(c.cost_amount) || 0);
    costByAsgMonth.set(c.assignment_id, inner);
    (cmByAsg.get(c.assignment_id) ?? cmByAsg.set(c.assignment_id, []).get(c.assignment_id)!).push(c);
  }
  const activeAssignments = assignments.filter((a) => a.status !== "removed");
  const v = VERDICT[verdict];
  const baselined = !!plan.baseline_locked_at;

  return (
    <div>
      <BackLink id={o.id} />
      <PageHeader
        title={o.account?.name ?? "案件"}
        subtitle={`${o.name}｜案件管理`}
        action={<span className={`pill ${v.cls} font-bold`}>提案可否：{v.label}</span>}
      />

      {searchParams.saved && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          ✓ {searchParams.saved === "baseline" ? "ベースラインを確定しました" : searchParams.saved === "weekly" ? "週次実績を記録しました" : "保存しました"}
        </div>
      )}

      {/* サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">販売計画（合計）</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(roll.totals.revenue)}</div></Card>
        <Card><div className="text-xs text-ink/50">原価計画（合計）</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(roll.totals.cost)}</div></Card>
        <Card><div className="text-xs text-ink/50">粗利（合計）</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(roll.totals.gross)}</div></Card>
        <Card><div className="text-xs text-ink/50">粗利率</div><div className={`text-2xl font-bold mt-1 tabular-nums ${rateCls(roll.totals.grossRate)}`}>{formatPercent(roll.totals.grossRate, 1)}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          {/* 月別マトリクス */}
          <Section title="月別 原価・粗利マトリクス" action={<span className="text-[11px] text-ink/40">アサイン×月の原価を積み上げ、販売と突き合わせ</span>}>
            {months.length === 0 ? (
              <p className="text-sm text-ink/40 py-6 text-center">販売計画とアサインを登録すると、月別の粗利が表示されます。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums" style={{ minWidth: 420 }}>
                  <thead className="text-ink/40 text-xs bg-mist-soft/30">
                    <tr>
                      <th className="th">アサイン / 単価</th>
                      {months.map((m) => <th key={m} className="th text-right">{ymLabel(m)}</th>)}
                      <th className="th text-right">合計</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04]">
                    {activeAssignments.map((a) => {
                      const inner = costByAsgMonth.get(a.id);
                      const total = months.reduce((s, m) => s + (inner?.get(m) ?? 0), 0);
                      return (
                        <tr key={a.id}>
                          <td className="td"><div className="font-medium text-ink/90">{a.label}</div><div className="text-[11px] text-ink/45">{a.role ? a.role + "・" : ""}{formatYen(Number(a.cost_rate))}{rateSuffix(a.rate_unit)}</div></td>
                          {months.map((m) => <td key={m} className="td text-right text-ink/70">{inner?.get(m) ? formatYen(inner.get(m)!) : "—"}</td>)}
                          <td className="td text-right font-semibold">{formatYen(total)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-mist-soft/40 font-semibold">
                      <td className="td">月次原価合計</td>
                      {roll.months.map((m) => <td key={m.month} className="td text-right">{formatYen(m.cost)}</td>)}
                      <td className="td text-right">{formatYen(roll.totals.cost)}</td>
                    </tr>
                    <tr>
                      <td className="td text-ink/60">販売計画</td>
                      {roll.months.map((m) => <td key={m.month} className="td text-right text-ink/70">{formatYen(m.revenue)}</td>)}
                      <td className="td text-right">{formatYen(roll.totals.revenue)}</td>
                    </tr>
                    <tr className="bg-mist-soft/40 font-semibold">
                      <td className="td">月次粗利</td>
                      {roll.months.map((m) => <td key={m.month} className={`td text-right ${m.gross < 0 ? "text-rose-600" : ""}`}>{formatYen(m.gross)}</td>)}
                      <td className="td text-right">{formatYen(roll.totals.gross)}</td>
                    </tr>
                    <tr>
                      <td className="td text-ink/60">粗利率</td>
                      {roll.months.map((m) => <td key={m.month} className={`td text-right font-medium ${rateCls(m.grossRate)}`}>{formatPercent(m.grossRate, 0)}</td>)}
                      <td className={`td text-right font-bold ${rateCls(roll.totals.grossRate)}`}>{formatPercent(roll.totals.grossRate, 1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* 稼働実績(週次承認済み→実績原価) */}
          <Section title="稼働実績（週次承認済み）" action={<Link href="/app/projects/approvals" className="text-[11px] text-teal-deep hover:underline">稼働承認へ</Link>}>
            {(() => {
              const H = Number(plan.hours_per_month) || 160;
              const actualMonths = [...new Set([...byAssignmentMonth.values()].flatMap((m) => [...m.keys()]))];
              const workMonths = [...new Set([...months, ...actualMonths])].sort();
              const plannedHoursByAsgMonth = new Map<string, Map<string, number>>();
              for (const c of costMonths) {
                const inner = plannedHoursByAsgMonth.get(c.assignment_id) ?? new Map<string, number>();
                inner.set(monthKey(c.month), c.hours != null ? Number(c.hours) : Math.round((Number(c.man_month) || 0) * Number(c.ratio ?? 1) * H));
                plannedHoursByAsgMonth.set(c.assignment_id, inner);
              }
              const asgRows = assignments.filter((a) => a.status !== "removed" || byAssignmentMonth.has(a.id));
              if (workMonths.length === 0 || asgRows.length === 0) {
                return <p className="text-sm text-ink/40 py-6 text-center">承認済みの稼働実績はまだありません。担当者が「稼働報告」で記入・提出し、「稼働承認」で承認すると反映されます。</p>;
              }
              const actualCostByMonth = new Map<string, number>();
              for (const a of asgRows) {
                const am = byAssignmentMonth.get(a.id);
                if (!am) continue;
                for (const [m, h] of am) actualCostByMonth.set(m, (actualCostByMonth.get(m) ?? 0) + hoursToCost(h, Number(a.cost_rate) || 0, a.rate_unit ?? "man_month", H));
              }
              const totalActualCost = [...actualCostByMonth.values()].reduce((s, v) => s + v, 0);
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums" style={{ minWidth: 480 }}>
                    <thead className="text-ink/40 text-xs bg-mist-soft/30">
                      <tr>
                        <th className="th">アサイン（実績h / 予定h）</th>
                        {workMonths.map((m) => <th key={m} className="th text-right">{ymLabel(m)}</th>)}
                        <th className="th text-right">合計</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04]">
                      {asgRows.map((a) => {
                        const am = byAssignmentMonth.get(a.id);
                        const pm = plannedHoursByAsgMonth.get(a.id);
                        const totalH = workMonths.reduce((s, m) => s + (am?.get(m) ?? 0), 0);
                        return (
                          <tr key={a.id}>
                            <td className="td font-medium text-ink/90">{a.label}</td>
                            {workMonths.map((m) => {
                              const act = am?.get(m) ?? 0;
                              const pl = pm?.get(m) ?? 0;
                              return (
                                <td key={m} className="td text-right text-ink/70">
                                  {act || pl ? (
                                    <span>
                                      <span className={act > pl && pl > 0 ? "text-rose-600 font-semibold" : "font-semibold"}>{act ? formatHoursHM(act) : "—"}</span>
                                      <span className="text-[11px] text-ink/40"> / {pl ? formatHoursHM(pl) : "—"}</span>
                                    </span>
                                  ) : "—"}
                                </td>
                              );
                            })}
                            <td className="td text-right font-semibold">{totalH ? formatHoursHM(totalH) : "—"}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-mist-soft/40 font-semibold">
                        <td className="td">実績原価（換算）</td>
                        {workMonths.map((m) => <td key={m} className="td text-right">{actualCostByMonth.get(m) ? formatYen(Math.round(actualCostByMonth.get(m)!)) : "—"}</td>)}
                        <td className="td text-right">{formatYen(Math.round(totalActualCost))}</td>
                      </tr>
                      <tr>
                        <td className="td text-ink/60">計画原価</td>
                        {workMonths.map((m) => {
                          const mm = roll.months.find((r) => r.month === m);
                          return <td key={m} className="td text-right text-ink/70">{mm?.cost ? formatYen(mm.cost) : "—"}</td>;
                        })}
                        <td className="td text-right">{formatYen(roll.totals.cost)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[11px] text-ink/40 mt-1.5">実績hは承認済みの稼働報告の合計。実績原価は単価換算（人月単価は月{H}hで時間割り）。</p>
                </div>
              );
            })()}
          </Section>

          {/* 販売計画 */}
          <Section title="販売（売上）計画（月別）">
            <ProjectRevenueForm planId={plan.id} oppId={o.id} seedMonths={seedMonths} initial={revenues.map((r) => ({ month: monthKey(r.month), amount: Number(r.amount) }))} />
          </Section>

          {/* アサイン */}
          <Section title={`アサイン（${activeAssignments.length}）`} action={<span className="text-[11px] text-ink/40">外注・社員の単価と月別工数</span>}>
            <div className="space-y-2.5">
              {activeAssignments.map((a) => (
                <details key={a.id} className="rounded-xl border border-black/[0.06]">
                  <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center gap-2 hover:bg-mist-soft/40">
                    <span className="text-sm font-medium text-ink">{a.label}</span>
                    <span className="pill bg-mist-soft text-ink/50 text-[10px]">{a.kind === "internal" ? "社員" : "外注"}</span>
                    {a.role && <span className="text-[11px] text-ink/45">{a.role}</span>}
                    <span className="ml-auto text-xs text-ink/55 tabular-nums">{formatYen(Number(a.cost_rate))}{rateSuffix(a.rate_unit)}</span>
                  </summary>
                  <div className="border-t border-black/[0.05] p-3 space-y-3">
                    <ProjectAssignmentForm
                      planId={plan.id} oppId={o.id} members={members.map((m) => ({ id: m.id, name: m.name }))} seedMonths={seedMonths}
                      hoursPerMonth={Number(plan.hours_per_month) || 160}
                      existing={toExisting(a, cmByAsg.get(a.id) ?? [])}
                    />
                    <form action={deleteAssignmentAction} className="pt-1 border-t border-black/[0.04]">
                      <input type="hidden" name="assignment_id" value={a.id} />
                      <input type="hidden" name="opportunity_id" value={o.id} />
                      <button className="inline-flex items-center gap-1 text-[11px] text-rose-500 hover:underline"><Trash2 size={12} /> このアサインを削除</button>
                    </form>
                  </div>
                </details>
              ))}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ アサインを追加</summary>
              <div className="mt-3 border-t border-black/[0.05] pt-3">
                <ProjectAssignmentForm planId={plan.id} oppId={o.id} members={members.map((m) => ({ id: m.id, name: m.name }))} seedMonths={seedMonths} hoursPerMonth={Number(plan.hours_per_month) || 160} />
              </div>
            </details>
          </Section>

          {/* 実績(予実): 週次/月次/終了時 */}
          <Section title="実績（予実）" action={<span className="text-[11px] text-ink/40">週次・月次・終了時で予定と実績を比較</span>}>
            <div className="space-y-2">
              {weekly.length === 0 ? (
                <p className="text-sm text-ink/40 py-2">まだ実績がありません。</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums" style={{ minWidth: 520 }}>
                    <thead className="text-ink/40 text-xs bg-mist-soft/30">
                      <tr><th className="th">区分</th><th className="th">対象</th><th className="th text-right">予定原価</th><th className="th text-right">実績原価</th><th className="th text-right">差異</th><th className="th">状態</th><th className="th">報告者</th><th className="th"></th></tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04]">
                      {weekly.map((w) => {
                        const va = costVariance(Number(w.planned_cost) || 0, Number(w.actual_cost) || 0);
                        const st = va.status === "over" || w.status === "over" ? "over" : va.status === "watch" || w.status === "watch" ? "watch" : w.status === "blocked" ? "blocked" : "on_track";
                        const stCls = st === "over" ? "bg-rose-50 text-rose-600" : st === "watch" ? "bg-amber-50 text-amber-700" : st === "blocked" ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700";
                        const stLabel = st === "over" ? "超過" : st === "watch" ? "やや超" : st === "blocked" ? "停滞" : "順調";
                        const pType = w.period_type ?? "weekly";
                        const pLabel = pType === "monthly" ? "月次" : pType === "final" ? "終了時" : "週次";
                        const pTarget = pType === "monthly" ? ymLabelMonth(w.period_month) : pType === "final" ? "全体" : formatDateFull(w.week_start);
                        return (
                          <tr key={w.id}>
                            <td className="td"><span className="pill bg-mist-soft text-ink/50 text-[10px]">{pLabel}</span></td>
                            <td className="td text-ink/70">{pTarget}</td>
                            <td className="td text-right text-ink/70">{w.planned_cost != null ? formatYen(Number(w.planned_cost)) : "—"}</td>
                            <td className="td text-right text-ink/70">{w.actual_cost != null ? formatYen(Number(w.actual_cost)) : "—"}</td>
                            <td className={`td text-right ${va.diff > 0 ? "text-rose-600" : "text-emerald-600"}`}>{w.planned_cost != null && w.actual_cost != null ? (va.diff > 0 ? "+" : "") + formatYen(va.diff) : "—"}</td>
                            <td className="td"><span className={`pill ${stCls} text-[10px]`}>{stLabel}</span></td>
                            <td className="td text-ink/60 text-xs">{w.reporter ?? "—"}</td>
                            <td className="td">
                              <form action={deleteWeeklyReportAction}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="opportunity_id" value={o.id} /><button className="text-ink/30 hover:text-rose-500" aria-label="削除"><Trash2 size={13} /></button></form>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 週次実績を記録</summary>
              <div className="mt-3 border-t border-black/[0.05] pt-3">
                <ProjectWeeklyForm
                  planId={plan.id}
                  oppId={o.id}
                  hoursPerMonth={Number(plan.hours_per_month) || 160}
                  assignments={activeAssignments.map((a) => ({ id: a.id, label: a.label, cost_rate: Number(a.cost_rate), rate_unit: a.rate_unit ?? "man_month", effort_unit: a.effort_unit ?? "ratio" }))}
                  monthlyPlan={roll.months.map((m) => ({ month: m.month, cost: m.cost }))}
                  totalPlanCost={roll.totals.cost}
                />
              </div>
            </details>
          </Section>
        </div>

        {/* 右: 提案可否・計画設定 */}
        <div className="space-y-5 lg:sticky lg:top-4">
          <Section title="提案可否パネル">
            <div className={`rounded-xl px-4 py-3 mb-3 ${v.cls}`}>
              <div className="text-xs opacity-70">判定</div>
              <div className="text-xl font-bold">{v.label}</div>
            </div>
            <dl className="space-y-2 text-sm">
              <RowKV k="粗利率"><span className={`font-bold ${rateCls(roll.totals.grossRate)}`}>{formatPercent(roll.totals.grossRate, 1)}</span></RowKV>
              <RowKV k="最低粗利率">{formatPercent(Number(plan.min_gross_rate), 0)}</RowKV>
              <RowKV k="下限価格">{Number.isFinite(room.minPrice) ? formatYen(room.minPrice) : "—"}</RowKV>
              <RowKV k="値引き余地">
                {room.roomAmount >= 0
                  ? <span className="text-emerald-600 font-medium">{formatYen(room.roomAmount)}（{formatPercent(room.roomPct, 1)}）</span>
                  : <span className="text-rose-600 font-medium">下限割れ {formatYen(room.roomAmount)}</span>}
              </RowKV>
              <RowKV k="本部関与">{INVOLVE[plan.hq_involvement] ?? plan.hq_involvement}</RowKV>
              <RowKV k="計画リスク">{RISK[plan.plan_risk] ?? plan.plan_risk}</RowKV>
            </dl>
            {!baselined ? (
              <form action={lockBaselineAction} className="mt-3 pt-3 border-t border-black/[0.05]">
                <input type="hidden" name="plan_id" value={plan.id} />
                <input type="hidden" name="opportunity_id" value={o.id} />
                <button className="inline-flex items-center gap-1.5 btn-primary w-full justify-center"><Lock size={14} /> 受注：この計画をベースライン確定</button>
                <p className="text-[11px] text-ink/40 mt-1.5">確定すると、以後の週次実績はこの計画と比較します。</p>
              </form>
            ) : (
              <p className="mt-3 pt-3 border-t border-black/[0.05] text-xs text-ink/50">✓ ベースライン確定済み（{formatDateFull(plan.baseline_locked_at)}）</p>
            )}
          </Section>

          <Section title="計画設定">
            <form action={updateProjectPlanAction} className="space-y-3">
              <input type="hidden" name="plan_id" value={plan.id} />
              <input type="hidden" name="opportunity_id" value={o.id} />
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">開始月</label><input name="start_month" type="month" defaultValue={monthKey(plan.start_month)} className="input" /></div>
                <div><label className="label">終了月</label><input name="end_month" type="month" defaultValue={monthKey(plan.end_month)} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">最低粗利率(%)</label><input name="min_gross_rate" type="number" min={0} max={99} defaultValue={Math.round(Number(plan.min_gross_rate) * 100)} className="input" /><p className="text-[10px] text-ink/40 mt-1">値引き下限価格の計算に使用</p></div>
                <div><label className="label">1人月あたり時間(h)</label><input name="hours_per_month" type="number" min={1} defaultValue={Number(plan.hours_per_month) || 160} className="input" /><p className="text-[10px] text-ink/40 mt-1">人月⇔時給・率⇔時間の換算に使用</p></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">重要度</label>
                  <select name="priority" defaultValue={plan.priority ?? "middle"} className="input"><option value="high">高</option><option value="middle">中</option><option value="low">低</option></select>
                </div>
                <div><label className="label">本部関与</label>
                  <select name="hq_involvement" defaultValue={plan.hq_involvement} className="input"><option value="none">なし</option><option value="low">小</option><option value="middle">中</option><option value="high">大</option></select>
                </div>
                <div><label className="label">計画リスク</label>
                  <select name="plan_risk" defaultValue={plan.plan_risk} className="input"><option value="low">低</option><option value="middle">中</option><option value="high">高</option></select>
                </div>
              </div>
              <div><label className="label">メモ</label><textarea name="notes" rows={2} defaultValue={plan.notes ?? ""} className="input" /></div>
              <SubmitButton className="btn-primary" pendingLabel="保存中…">計画を保存</SubmitButton>
            </form>
          </Section>

          <DocumentSection targetType="project" targetId={o.id} revalidatePath={`/app/projects/${o.id}`} />

          <Section title="対象設定">
            <p className="text-xs text-ink/50 mb-2">担当営業：{o.owner_user_id ? getUser(ws, o.owner_user_id)?.name ?? "—" : "—"}</p>
            <form action={disableProjectManagementAction}>
              <input type="hidden" name="opportunity_id" value={o.id} />
              <button className="text-[11px] text-ink/45 hover:text-rose-500 hover:underline">案件管理の対象から外す</button>
            </form>
          </Section>
        </div>
      </div>
    </div>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <Link href="/app/projects" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink"><ChevronLeft size={16} /> 案件管理一覧</Link>
      <Link href={`/app/opportunities/${id}`} className="text-sm text-teal-deep hover:underline">案件詳細を開く</Link>
    </div>
  );
}
function RowKV({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-ink/45 text-xs">{k}</dt><dd className="text-right">{children}</dd></div>;
}
function toExisting(a: ProjAssignment, cells: CostMonth[]) {
  return {
    id: a.id, kind: a.kind, member_user_id: a.member_user_id, label: a.label, role: a.role,
    cost_rate: Number(a.cost_rate), bill_rate: a.bill_rate == null ? null : Number(a.bill_rate),
    rate_unit: a.rate_unit ?? "man_month", effort_unit: a.effort_unit ?? "ratio",
    start_month: a.start_month, end_month: a.end_month,
    cells: [...cells]
      .sort((x, y) => x.month.localeCompare(y.month))
      .map((c) => ({ month: monthKey(c.month), manMonth: Number(c.man_month) || 0, ratio: Number(c.ratio ?? 1), hours: c.hours == null ? null : Number(c.hours) })),
  };
}

const INVOLVE: Record<string, string> = { none: "なし", low: "小", middle: "中", high: "大" };
const RISK: Record<string, string> = { low: "低", middle: "中", high: "高" };
const rateSuffix = (u?: string) => (u === "hourly" ? "/h" : "/人月");
