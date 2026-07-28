import { NotebookPen } from "lucide-react";
import { Card, LinkButton, ProgressBar, Section } from "@/components/ui/primitives";
import { getRepReport } from "@/lib/data/rep-report";
import { mondayJst } from "@/lib/data/weekly-snapshot";
import { formatYen, formatPercent } from "@/lib/utils";

/**
 * 営業マン別週報ガジェット: 自分の今週の目標・実績・見込みとパイプラインの要約。
 * 全メンバーの週報は「営業マン別週報」ページ(SALES_NUMBER_ROLES のみ)で確認する。
 */
export async function RepWeeklyGadget({ userId }: { userId: string }) {
  const week = mondayJst(new Date());
  const report = await getRepReport(userId, week);

  const rows: { label: string; value: string }[] = [
    { label: "今月目標", value: formatYen(report.month.target) },
    { label: "実績(受注)", value: formatYen(report.month.actual) },
    { label: "着地見込み", value: formatYen(report.month.forecast) },
  ];

  return (
    <Section
      title={`週報サマリー（${week}週）`}
      icon={<NotebookPen size={16} />}
      action={<LinkButton href="/app/reviews/rep" variant="ghost">週報へ</LinkButton>}
    >
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {rows.map((r) => (
            <div key={r.label} className="rounded-lg bg-slate-50 px-2 py-2 text-center">
              <div className="text-[11px] text-slate-400">{r.label}</div>
              <div className="text-sm font-semibold text-slate-700 tabular-nums truncate">{r.value}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>達成率</span>
            <span className="tabular-nums">{formatPercent(report.month.achieve)}</span>
          </div>
          <ProgressBar value={report.month.actual} max={Math.max(report.month.target, 1)} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 pt-1 border-t border-slate-100">
          <span>進行中 <b className="text-slate-700 tabular-nums">{report.pipeline.openCount}</b>件</span>
          <span>金額 <b className="text-slate-700 tabular-nums">{formatYen(report.pipeline.openAmount)}</b></span>
          <span>停滞 <b className="text-amber-600 tabular-nums">{report.pipeline.stalled}</b>件</span>
          <span>要注意 <b className="text-rose-600 tabular-nums">{report.pipeline.risky}</b>件</span>
        </div>
      </Card>
    </Section>
  );
}
