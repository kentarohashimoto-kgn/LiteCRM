import Link from "next/link";
import { CalendarCheck, AlertTriangle, Clock, Target as TargetIcon } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { getSalesTargets, listOpportunities, listTasks } from "@/lib/data/select";
import { buildForecast } from "@/lib/forecast";
import { isStale, noNextAction } from "@/lib/risk";
import { repMetrics, productMetrics } from "@/lib/analytics";
import { Card, PageHeader, ProgressBar, Section, StatCard } from "@/components/ui/primitives";
import { ForecastChart, SimpleBar } from "@/components/charts/forecast-chart";
import { OppMiniList } from "@/components/opportunities/opp-mini-list";
import { formatYen, formatManYen, sameMonth, formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const ws = await getWorkspace();
  const now = new Date();
  const opps = listOpportunities(ws);
  const tasks = listTasks(ws);
  const targets = getSalesTargets(ws);
  const buckets = buildForecast(opps, targets, 6, now);
  const thisMonth = buckets[0];

  const openOpps = opps.filter((o) => o.status === "open");
  const noNext = openOpps.filter(noNextAction);
  const stale = openOpps.filter((o) => isStale(o, now));
  const closingThisMonth = openOpps
    .filter((o) => sameMonth(o.expected_close_date, now))
    .sort((a, b) => b.amount - a.amount);

  const todayStr = now.toISOString().slice(0, 10);
  const todayTasks = tasks.filter((t) => t.status === "todo" && t.due_date === todayStr);
  const overdueTasks = tasks.filter((t) => t.status === "todo" && t.due_date < todayStr);

  const reps = repMetrics(openOpps);
  const products = productMetrics(openOpps).slice(0, 6);
  const achieve = thisMonth.target > 0 ? thisMonth.bestCase / thisMonth.target : 0;

  return (
    <div>
      <PageHeader
        title="ダッシュボード"
        subtitle="今月の着地と打ち手を一目で。未来の売上を作るための起点です。"
      />

      {/* 強調指標 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <StatCard label="今月の売上目標" amount={thisMonth.target} />
        <StatCard label="Commit(受注確実)" amount={thisMonth.commit} />
        <StatCard label="Best Case込み着地" amount={thisMonth.bestCase} />
        <StatCard label="Weighted見込み" amount={thisMonth.weighted} />
        <StatCard
          label="目標とのGap"
          amount={thisMonth.gap}
          accent
          sub={thisMonth.gap >= 0 ? "目標到達ペース" : "不足"}
        />
      </div>

      <Card className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-ink">今月の目標達成度</span>
          <span className="text-sm tabular-nums">
            <span className="font-bold text-teal-deep">{formatYen(thisMonth.bestCase)}</span>
            <span className="text-ink/40"> / {formatYen(thisMonth.target)}</span>
            <span className="ml-2 font-bold stat-accent">{Math.round(achieve * 100)}%</span>
          </span>
        </div>
        <ProgressBar value={thisMonth.bestCase} max={thisMonth.target} tone={achieve >= 1 ? "teal" : "orange"} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Section
          title="売上予測(今後6ヶ月)"
          icon={<TargetIcon size={15} />}
          className="lg:col-span-2"
          action={
            <Link href="/app/forecast" className="text-xs font-semibold text-teal-primary hover:underline">
              詳細 →
            </Link>
          }
        >
          <ForecastChart
            data={buckets.map((b) => ({
              label: b.label,
              commit: b.commit,
              bestCase: Math.max(0, b.bestCase - b.commit),
              pipeline: b.pipeline,
              weighted: b.weighted,
              target: b.target,
            }))}
          />
        </Section>

        <Section title="今日やること" icon={<CalendarCheck size={15} />}>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-ink/60">今日のタスク</span>
                <span className="pill bg-teal-light text-teal-deep">{todayTasks.length}</span>
              </div>
              <TaskMini tasks={todayTasks} empty="今日のタスクはありません" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-rose-500">期限切れタスク</span>
                <span className="pill bg-rose-100 text-rose-600">{overdueTasks.length}</span>
              </div>
              <TaskMini tasks={overdueTasks} empty="期限切れはありません" danger />
            </div>
            <Link href="/app/tasks" className="block text-center text-xs font-semibold text-teal-primary hover:underline">
              すべてのタスク →
            </Link>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Section
          title="次アクション未設定"
          icon={<AlertTriangle size={15} className="text-accent-orange" />}
          action={<span className="pill bg-amber-50 text-accent-orange">{noNext.length}件</span>}
        >
          <OppMiniList opps={noNext} limit={5} emptyMessage="未設定の案件はありません" />
        </Section>
        <Section
          title="7日以上 更新なし"
          icon={<Clock size={15} className="text-rose-500" />}
          action={<span className="pill bg-rose-100 text-rose-600">{stale.length}件</span>}
        >
          <OppMiniList opps={stale} showRisk limit={5} emptyMessage="放置案件はありません" />
        </Section>
        <Section
          title="今月クロージング対象"
          icon={<TargetIcon size={15} className="text-teal-primary" />}
          action={<span className="pill bg-teal-light text-teal-deep">{closingThisMonth.length}件</span>}
        >
          <OppMiniList opps={closingThisMonth} limit={5} emptyMessage="今月受注予定の案件はありません" />
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="営業マン別 見込み(Weighted)">
          {reps.length ? (
            <SimpleBar data={reps.map((r) => ({ label: r.name, value: r.weighted }))} />
          ) : (
            <p className="text-sm text-ink/40 py-8 text-center">データがありません</p>
          )}
        </Section>
        <Section title="商品別 見込み(進行中金額)">
          {products.length ? (
            <SimpleBar data={products.map((p) => ({ label: p.name, value: p.openAmount }))} color="#F59A2A" />
          ) : (
            <p className="text-sm text-ink/40 py-8 text-center">データがありません</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function TaskMini({
  tasks,
  empty,
  danger = false,
}: {
  tasks: { id: string; title: string; due_date: string }[];
  empty: string;
  danger?: boolean;
}) {
  if (!tasks.length) return <p className="text-xs text-ink/35 py-1">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {tasks.slice(0, 4).map((t) => (
        <li key={t.id} className="flex items-center justify-between text-sm">
          <span className="truncate text-ink/80">{t.title}</span>
          <span className={`text-xs shrink-0 ml-2 ${danger ? "text-rose-500" : "text-ink/40"}`}>
            {formatDate(t.due_date)}
          </span>
        </li>
      ))}
    </ul>
  );
}
