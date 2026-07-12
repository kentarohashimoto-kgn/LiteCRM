import Link from "next/link";
import { User, Save } from "lucide-react";
import { Section, StatCard, EmptyState, ProgressBar } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatYen, formatPercent, formatDate } from "@/lib/utils";
import { saveRepReportAction } from "@/server/actions/rep-report";
import type { RepReport } from "@/lib/data/rep-report";

export function RepReportView({ report, weekStart }: { report: RepReport; weekStart: string }) {
  const m = report.month;
  return (
    <div className="space-y-6">
      {/* 対象選択 */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-ink/50 mb-1">営業担当</label>
          <select name="owner" defaultValue={report.ownerId} className="rounded-lg border border-black/10 px-3 py-2 text-sm">
            {report.members.map((mem) => (
              <option key={mem.id} value={mem.id}>{mem.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink/50 mb-1">対象週(月曜)</label>
          <input type="date" name="week" defaultValue={weekStart} className="rounded-lg border border-black/10 px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="btn-ghost">表示</button>
      </form>

      {/* 今月の着地 */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-ink">
          <User size={15} className="text-teal-primary" />
          {report.ownerName} の週報（{formatDate(weekStart)}週）
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="今月 目標" amount={m.target} />
          <StatCard label="今月 実績(受注)" amount={m.actual} accent />
          <StatCard label="月末見込み" amount={m.forecast} />
          <StatCard label="達成率(見込)" raw={formatPercent(m.achieve)} sub={<ProgressBar value={m.forecast} max={m.target || 1} />} />
        </div>
      </div>

      {/* パイプライン */}
      <Section title="パイプライン現況">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="進行中案件" raw={`${report.pipeline.openCount}`} sub={formatYen(report.pipeline.openAmount)} />
          <StatCard label="Weighted" amount={report.pipeline.weighted} />
          <StatCard label="今月クローズ予定" raw={`${report.pipeline.closingCount}`} sub={formatYen(report.pipeline.closingAmount)} />
          <StatCard label="停滞 / 危険" raw={`${report.pipeline.stalled} / ${report.pipeline.risky}`} accent={report.pipeline.risky > 0} sub="件" />
        </div>
      </Section>

      {/* 担当案件リスト */}
      <Section title={`担当案件（進行中 ${report.opps.length}）`}>
        {report.opps.length === 0 ? (
          <EmptyState message="進行中の担当案件がありません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th className="th">顧客 / 案件</th>
                  <th className="th">ヨミ</th>
                  <th className="th text-right">金額</th>
                  <th className="th text-right">Weighted</th>
                  <th className="th">次回AC</th>
                  <th className="th">クローズ予定</th>
                </tr>
              </thead>
              <tbody>
                {report.opps.map((o) => (
                  <tr key={o.id} className="row-hover border-t border-black/[0.04]">
                    <td className="td">
                      <Link href={`/app/opportunities/${o.id}`} className="hover:text-teal-deep">
                        {o.account ? <span className="text-ink/50">{o.account}／</span> : null}{o.name}
                      </Link>
                    </td>
                    <td className="td text-ink/70">{o.yomi ?? "—"}</td>
                    <td className="td text-right">{formatYen(o.amount)}</td>
                    <td className="td text-right text-ink/70">{formatYen(o.weighted)}</td>
                    <td className="td text-ink/70">{o.nextActionDate ? formatDate(o.nextActionDate) : <span className="text-rose-500">未設定</span>}</td>
                    <td className="td text-ink/70">{formatDate(o.expectedClose)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ナラティブ入力 */}
      <Section title="週次コメント（型に沿って記入）">
        <form action={saveRepReportAction} className="space-y-3">
          <input type="hidden" name="owner_user_id" value={report.ownerId} />
          <input type="hidden" name="week_start" value={weekStart} />
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">先週の予定に対する実績・差分コメント</label>
            <textarea name="last_week_comment" rows={3} defaultValue={report.narrative?.last_week_comment ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">来週の予定</label>
            <textarea name="next_week_plan" rows={3} defaultValue={report.narrative?.next_week_plan ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">1ヶ月先までの行動予定・想定工数</label>
            <textarea name="month_ahead_plan" rows={3} defaultValue={report.narrative?.month_ahead_plan ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">メモ</label>
            <textarea name="note" rows={2} defaultValue={report.narrative?.note ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end">
            <SubmitButton className="btn-primary inline-flex items-center gap-1.5" pendingLabel="保存中…"><Save size={15} /> 週報を保存</SubmitButton>
          </div>
        </form>
      </Section>
    </div>
  );
}
