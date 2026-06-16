import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { getKpiReview, listMtgActions, getExecAlerts, weeksInMonth, parsePeriod } from "@/lib/data/exec";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { PeriodSelect } from "@/components/exec/period-select";
import { EVALUATION_META, KPI_LABEL, DEPARTMENTS, STATUS_LABEL } from "@/lib/exec-review";
import { formatDateFull } from "@/lib/utils";

export default async function ExecSummaryPage({ searchParams }: { searchParams: { month?: string; week?: string } }) {
  const { month, week } = parsePeriod(searchParams);
  const [rows, actions] = await Promise.all([getKpiReview(month, week), listMtgActions()]);
  const alerts = await getExecAlerts(rows, actions);
  const bad = rows.filter((r) => r.judge.evaluation === "bad");
  const watch = rows.filter((r) => r.judge.evaluation === "watch");
  const good = rows.filter((r) => r.judge.evaluation === "good");

  // 部門別 Good/Watch/Bad(現状は営業のみ実データ。他部門はPhase2-4)
  const salesCounts = { good: good.length, watch: watch.length, bad: bad.length };

  return (
    <div>
      <PageHeader
        title="週次サマリー"
        subtitle="幹部MTGの起点。部門横断でGood/Watch/Badを把握し、課題のある項目に議論を集中させます。"
        action={<PeriodSelect month={month} week={week} weeks={weeksInMonth(month)} basePath="/app/exec" />}
      />

      {/* 部門別 判定 */}
      <Section title="部門別 状態（Good / Watch / Bad）" className="mb-5" action={<Link href="/app/exec/kpi" className="text-xs font-semibold text-teal-primary hover:underline">営業KPI →</Link>}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {DEPARTMENTS.map((d) => {
            const c = d.key === "sales" ? salesCounts : null;
            return (
              <div key={d.key} className="card card-pad">
                <div className="text-sm font-semibold mb-2">{d.label}</div>
                {c ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="pill bg-teal-light text-teal-deep">G {c.good}</span>
                    <span className="pill bg-amber-100 text-amber-700">W {c.watch}</span>
                    <span className="pill bg-rose-100 text-rose-600">B {c.bad}</span>
                  </div>
                ) : <div className="text-[11px] text-ink/35">Phase2以降で追加</div>}
              </div>
            );
          })}
        </div>
      </Section>

      {/* 重要アラート */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">Bad項目</div><div className="text-2xl font-bold mt-1 text-rose-600">{alerts.bad}</div></Card>
        <Card><div className="text-xs text-ink/50">Watch項目</div><div className="text-2xl font-bold mt-1 text-amber-600">{alerts.watch}</div></Card>
        <Card><div className="text-xs text-ink/50">未完了アクション</div><div className="text-2xl font-bold mt-1">{alerts.openActions}</div></Card>
        <Card><div className="text-xs text-ink/50">期限超過アクション</div><div className="text-2xl font-bold mt-1 text-rose-600">{alerts.overdue.length}</div></Card>
      </div>

      {/* 今週の重点論点(Bad→Watch) */}
      <Section title="今週議論すべき重点論点" icon={<AlertTriangle size={15} className="text-accent-orange" />} className="mb-5">
        {[...bad, ...watch].length === 0 ? (
          <p className="text-sm text-ink/40 py-4 text-center">Bad/Watch項目はありません。計画通りです。</p>
        ) : (
          <ul className="space-y-3">
            {[...bad, ...watch].map((r) => {
              const m = EVALUATION_META[r.judge.evaluation];
              const firstLines = r.systemComment.split("\n").slice(1, 3).join(" ");
              return (
                <li key={r.kpiType} className="flex gap-3">
                  <span className={`pill text-[10px] font-bold shrink-0 h-fit ${m.color}`}>{m.label}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{KPI_LABEL[r.kpiType]}<span className="text-ink/40 font-normal"> ・ {r.review?.countermeasure ? "対策あり" : "対策未設定"}</span></div>
                    <p className="text-xs text-ink/55 mt-0.5 line-clamp-2">{firstLines}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* 期限超過アクション */}
      <Section title="期限超過アクション" icon={<Clock size={15} className="text-rose-500" />} action={<Link href="/app/exec/actions" className="text-xs font-semibold text-teal-primary hover:underline">アクション管理 →</Link>}>
        {alerts.overdue.length === 0 ? (
          <p className="text-sm text-ink/40 py-3">期限超過はありません。</p>
        ) : (
          <ul className="divide-y divide-black/[0.05]">
            {alerts.overdue.slice(0, 8).map((a) => (
              <li key={a.id} className="py-2 flex items-center justify-between text-sm">
                <span className="truncate">{a.title}<span className="text-xs text-ink/40 ml-2">{STATUS_LABEL[a.status]}</span></span>
                <span className="text-xs text-rose-500 shrink-0 ml-2">{formatDateFull(a.due_date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export const dynamic = "force-dynamic";
