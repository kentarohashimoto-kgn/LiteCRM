import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2, Undo2, Inbox } from "lucide-react";
import { requireProjectCtx } from "@/lib/session";
import { getPendingWorkWeeks, getMonthlyWorkSummary } from "@/lib/data/work-log";
import { approveWorkWeekAction, returnWorkWeekAction } from "@/server/actions/work-log";
import { todayJST, addDaysISO, monthEndOf, formatHoursHM, hoursToCost } from "@/lib/work-time";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatYen } from "@/lib/utils";

export const dynamic = "force-dynamic";

const fmtMD = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const KIND: Record<string, string> = { external: "外部委託", internal: "社員" };

function normMonthParam(v: string | undefined, fallback: string): string {
  const m = (v ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : fallback;
}
function addMonths(monthStart: string, n: number): string {
  const d = new Date(monthStart + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** 稼働承認: 提出された週次実績の承認/差戻しと、月次の承認済み工数集計(請求参考)。 */
export default async function WorkApprovalsPage({ searchParams }: { searchParams: { month?: string; saved?: string; error?: string } }) {
  await requireProjectCtx();
  const today = todayJST();
  const month = normMonthParam(searchParams.month, `${today.slice(0, 7)}-01`);
  const monthEnd = monthEndOf(month);
  const monthLabel = `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

  const [pending, summary] = await Promise.all([
    getPendingWorkWeeks(),
    getMonthlyWorkSummary(month, monthEnd),
  ]);

  const sumApproved = summary.reduce((s, r) => s + r.approvedHours, 0);
  const sumAmount = summary.reduce((s, r) => s + hoursToCost(r.approvedHours, r.costRate, r.rateUnit, r.hoursPerMonth), 0);

  return (
    <div>
      <PageHeader
        title="稼働承認"
        subtitle="提出された週次の稼働実績を承認/差戻しします。承認済みの実績は原価管理の実績原価と月次請求の根拠になります。"
        action={<Link href="/app/projects" className="btn-ghost text-xs">原価管理へ</Link>}
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{ approve: "承認しました。原価管理の実績に反映されます。", return: "差戻しました。記入者が修正して再提出できます。" }}
        errorMessages={{
          forbidden: "承認の権限がありません。",
          not_pending: "この週はすでに処理済みです（他の承認者が処理した可能性があります）。",
          invalid: "入力内容が不正です。",
          save_failed: "保存に失敗しました。再度お試しください。",
        }}
      />

      <Section title={`承認待ち（${pending.length}件）`} className="mb-6">
        {pending.length === 0 ? (
          <div className="py-10 text-center">
            <Inbox size={26} className="mx-auto text-ink/25 mb-2" />
            <p className="text-sm text-ink/50">承認待ちの提出はありません。</p>
          </div>
        ) : (
          <div className="space-y-5">
            {pending.map((p) => (
              <div key={p.week.id} className="rounded-xl border border-black/[0.06] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <div className="text-sm">
                    <span className="font-bold text-ink/90">{p.assignment.label}</span>
                    <span className="pill bg-mist-soft text-ink/50 text-[10px] ml-1.5">{KIND[p.assignment.kind] ?? p.assignment.kind}</span>
                    <span className="text-ink/60 ml-2">{p.accountName}｜{p.opportunityId ? (
                      <Link href={`/app/projects/${p.opportunityId}`} className="text-teal-deep hover:underline">{p.oppName}</Link>
                    ) : p.oppName}</span>
                  </div>
                  <div className="text-sm tabular-nums text-ink/70">
                    {p.week.week_start.slice(0, 4)}年 {fmtMD(p.week.week_start)}〜{fmtMD(addDaysISO(p.week.week_start, 6))} の週
                    <span className="ml-3">合計 <b>{formatHoursHM(p.totalHours)}</b></span>
                  </div>
                </div>
                <div className="overflow-x-auto mb-3">
                  <table className="w-full text-sm" style={{ minWidth: 900 }}>
                    <thead className="text-ink/40 text-xs bg-mist-soft/30">
                      <tr>
                        <th className="th">日付</th><th className="th text-right">時間</th><th className="th">タスク</th>
                        <th className="th">成果</th><th className="th">Next Action</th><th className="th">リスク・懸念</th><th className="th">メモ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04]">
                      {p.entries.map((e) => (
                        <tr key={e.id}>
                          <td className="td whitespace-nowrap tabular-nums">{fmtMD(e.work_date)}</td>
                          <td className="td text-right tabular-nums">{formatHoursHM(Number(e.hours) || 0)}</td>
                          <td className="td text-xs">{e.task_text ?? "—"}</td>
                          <td className="td text-xs">{e.outcome_text ?? "—"}</td>
                          <td className="td text-xs">{e.next_action_text ?? "—"}</td>
                          <td className="td text-xs">{e.risk_text ?? "—"}</td>
                          <td className="td text-xs">{e.memo ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <form action={returnWorkWeekAction} className="flex items-center gap-2">
                    <input type="hidden" name="week_id" value={p.week.id} />
                    <input type="hidden" name="month" value={month} />
                    <input name="review_note" className="input text-xs" placeholder="差戻し理由（記入者に表示）" style={{ width: 260 }} />
                    <SubmitButton className="btn-ghost inline-flex items-center gap-1 text-sm text-rose-600" pendingLabel="差戻し中…">
                      <Undo2 size={14} /> 差戻し
                    </SubmitButton>
                  </form>
                  <form action={approveWorkWeekAction}>
                    <input type="hidden" name="week_id" value={p.week.id} />
                    <input type="hidden" name="month" value={month} />
                    <SubmitButton className="btn-accent inline-flex items-center gap-1.5 text-sm" pendingLabel="承認中…">
                      <CheckCircle2 size={14} /> 承認
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={`月次サマリー（請求参考） — ${monthLabel}`}
        action={
          <div className="flex items-center gap-1.5 text-sm">
            <Link href={`/app/projects/approvals?month=${addMonths(month, -1)}`} className="btn-ghost px-2 py-1" aria-label="前の月"><ChevronLeft size={15} /></Link>
            <Link href={`/app/projects/approvals?month=${addMonths(month, 1)}`} className="btn-ghost px-2 py-1" aria-label="次の月"><ChevronRight size={15} /></Link>
            <Link href="/app/projects/approvals" className="btn-ghost text-xs">今月へ</Link>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4 mb-4 max-w-md">
          <Card><div className="text-xs text-ink/50">承認済み工数（{monthLabel}）</div><div className="stat-value mt-1 tabular-nums">{formatHoursHM(sumApproved)}</div></Card>
          <Card><div className="text-xs text-ink/50">原価額換算（請求参考）</div><div className="stat-value mt-1 tabular-nums">{formatYen(Math.round(sumAmount))}</div></Card>
        </div>
        {summary.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">この月の実績・予定はまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 860 }}>
              <thead className="text-ink/40 text-xs bg-mist-soft/30">
                <tr>
                  <th className="th">稼働者</th><th className="th">区分</th><th className="th">案件</th>
                  <th className="th text-right">予定工数</th><th className="th text-right">承認済み</th>
                  <th className="th text-right">承認待ち</th><th className="th text-right">予実差</th>
                  <th className="th text-right">単価</th><th className="th text-right">金額（承認済み）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {summary.map((r) => {
                  const diff = r.approvedHours - r.plannedHours;
                  const amount = hoursToCost(r.approvedHours, r.costRate, r.rateUnit, r.hoursPerMonth);
                  return (
                    <tr key={r.assignmentId} className="row-hover">
                      <td className="td font-medium text-ink/85">{r.label}{r.role ? <span className="text-xs text-ink/45 ml-1">({r.role})</span> : null}</td>
                      <td className="td"><span className="pill bg-mist-soft text-ink/50 text-[10px]">{KIND[r.kind] ?? r.kind}</span></td>
                      <td className="td text-xs text-ink/70">{r.accountName}｜{r.oppName}</td>
                      <td className="td text-right text-ink/70">{r.plannedHours ? formatHoursHM(r.plannedHours) : "—"}</td>
                      <td className="td text-right font-semibold">{formatHoursHM(r.approvedHours)}</td>
                      <td className="td text-right text-amber-700">{r.pendingHours ? formatHoursHM(r.pendingHours) : "—"}</td>
                      <td className={`td text-right ${!r.plannedHours ? "text-ink/30" : diff > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {r.plannedHours ? `${diff >= 0 ? "+" : "−"}${formatHoursHM(Math.abs(diff))}` : "—"}
                      </td>
                      <td className="td text-right text-xs text-ink/60">
                        {r.costRate ? `${formatYen(r.costRate)}/${r.rateUnit === "hourly" ? "時" : "人月"}` : "—"}
                      </td>
                      <td className="td text-right font-semibold">{formatYen(Math.round(amount))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink/40 mt-2">
          金額は「承認済み工数 × 原価単価」の換算値です（人月単価の場合は 月基準時間で時間割り）。外部委託先への支払・請求額の確認にご利用ください。
        </p>
      </Section>
    </div>
  );
}
