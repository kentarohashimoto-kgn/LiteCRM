import { User, Save, Target } from "lucide-react";
import { Section, StatCard, EmptyState, ProgressBar } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatYen, formatPercent, formatDate } from "@/lib/utils";
import { saveRepReportAction, saveRepMonthlyTargetAction } from "@/server/actions/rep-report";
import { RepTrendSummary } from "@/components/reviews/rep-trend-summary";
import { RepFunnel } from "@/components/reviews/rep-funnel";
import { RepOppTable } from "@/components/reviews/rep-opp-table";
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
        {/* 個人目標の設定(今月をブレークダウン) */}
        <form action={saveRepMonthlyTargetAction} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="owner_user_id" value={report.ownerId} />
          <input type="hidden" name="target_month" value={report.monthKey} />
          <input type="hidden" name="back_week" value={weekStart} />
          <Target size={14} className="text-ink/40" />
          <span className="text-xs text-ink/50">{report.monthKey} の個人目標</span>
          <input
            type="number"
            name="target_amount"
            defaultValue={m.target || ""}
            placeholder="円"
            min={0}
            step={100000}
            className="w-40 rounded-lg border border-black/10 px-3 py-1.5 text-sm text-right"
          />
          <SubmitButton className="btn-ghost text-xs" pendingLabel="保存中…">目標を保存</SubmitButton>
        </form>
      </div>

      {/* 推移グラフ(週別/月別) ＋ ヨミファネル */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RepTrendSummary monthly={report.trendMonthly} weekly={report.trendWeekly} />
        <RepFunnel funnel={report.funnel} />
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

      {/* 担当案件リスト(ソート・背景色・1行メモ) */}
      <Section title={`担当案件（進行中 ${report.opps.length}）`}>
        {report.opps.length === 0 ? (
          <EmptyState message="進行中の担当案件がありません。" />
        ) : (
          <RepOppTable opps={report.opps} ownerId={report.ownerId} weekStart={weekStart} />
        )}
      </Section>

      {/* ナラティブ入力(保存時に上部サマリーもスナップショット) */}
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
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink/45">保存すると、上部の集計サマリー（目標/実績/見込み/パイプライン/ファネル/推移/案件）もその時点で固定保存されます。</p>
            <SubmitButton className="btn-primary inline-flex items-center gap-1.5" pendingLabel="保存中…"><Save size={15} /> 週報を保存</SubmitButton>
          </div>
        </form>
      </Section>
    </div>
  );
}
