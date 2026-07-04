import Link from "next/link";
import { CalendarCheck, AlertTriangle, Clock, Target as TargetIcon } from "lucide-react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getDashboardMetrics, miniToOppView } from "@/lib/data/dashboard";
import { getLeadMetrics } from "@/lib/data/leads";
import { getSalesAlerts, summarizeAlerts } from "@/lib/data/alerts";
import { Card, PageHeader, ProgressBar, Section, StatCard } from "@/components/ui/primitives";
import { ForecastChart, SimpleBar } from "@/components/charts/forecast-chart";
import { MetricTrendChart, type TrendPoint } from "@/components/charts/trend-chart";
import { FunnelView } from "@/components/dashboard/funnel-view";
import { OppMiniList } from "@/components/opportunities/opp-mini-list";
import { currentFiscalStartYear, fiscalStartYear, fiscalMonths, fiscalYearLabel } from "@/lib/fiscal";
import { FyTabs } from "@/components/dashboard/fy-tabs";
import { formatYen, formatPercent, formatDate, sum, monthKey, startOfMonth, addMonths } from "@/lib/utils";

interface TargetRow { target_month: string; target_amount: number; target_deals?: number; target_appointments?: number; target_leads?: number; }

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const sb = getSupabaseServer();
  const currentFy = currentFiscalStartYear(now);

  // 目標・タスク(小)＋リード集計・アラート(RPC)を並列取得。案件はサーバー集計RPCへ移行。
  const [targetsR, tasksR, leadMetrics, alerts] = await Promise.all([
    sb.from("sales_targets").select("target_month,target_amount,target_deals,target_appointments,target_leads"),
    sb.from("tasks").select("id,title,due_date,status").eq("status", "todo"),
    getLeadMetrics(),
    getSalesAlerts(),
  ]);
  const targets = (targetsR.data ?? []) as TargetRow[];
  const allTasks = (tasksR.data ?? []) as { id: string; title: string; due_date: string; status: string }[];
  const alertRows = summarizeAlerts(alerts);
  const targetMap = new Map(targets.map((t) => [t.target_month, t]));

  // 年度候補(リード・目標のある年度＋当年度)。
  const yearSet = new Set<number>([currentFy]);
  for (const k of leadMetrics.byMonth.keys()) yearSet.add(fiscalStartYear(new Date(k)));
  for (const t of targets) if (t.target_month) yearSet.add(fiscalStartYear(new Date(t.target_month)));
  const availableYears = Array.from(yearSet).sort((a, b) => b - a);
  const fyParam = parseInt(sp.fy ?? "", 10);
  const fy = Number.isFinite(fyParam) && availableYears.includes(fyParam) ? fyParam : currentFy;

  // 案件集計はサーバー(RPC dashboard_metrics)から取得。
  const metrics = await getDashboardMetrics(fy);

  // 予測バケット(6ヶ月・現在起点)に目標を付与。
  const buckets = metrics.forecast6.map((f) => {
    const target = targetMap.get(f.month_key)?.target_amount ?? 0;
    return { monthKey: f.month_key, label: f.label, commit: f.commit, bestCase: f.bestcase, pipeline: f.pipeline, weighted: f.weighted, target, gap: f.bestcase - target };
  });
  const thisMonth = buckets[0] ?? { monthKey: "", label: "", commit: 0, bestCase: 0, pipeline: 0, weighted: 0, target: 0, gap: 0 };
  const achieve = thisMonth.target > 0 ? thisMonth.bestCase / thisMonth.target : 0;

  const todayStr = now.toISOString().slice(0, 10);
  const todayTasks = allTasks.filter((t) => t.due_date === todayStr);
  const overdueTasks = allTasks.filter((t) => t.due_date < todayStr);

  // 注意リスト(RPC由来をOppView互換へ変換)。
  const noNext = metrics.no_next.map(miniToOppView);
  const stale = metrics.stale.map(miniToOppView);
  const closingThisMonth = metrics.closing.map(miniToOppView);

  // 営業マン別/商品別。
  const reps = metrics.reps;
  const products = metrics.products.slice(0, 6).map((p) => ({ name: p.name, openAmount: p.open_amount }));

  // 年度(決算6月=7月始まり)の目標 vs 実績。
  const fiscalByKey = new Map(metrics.fiscal12.map((r) => [r.month_key, r]));
  const fyMonths = fiscalMonths(fy);
  const fyTarget = {
    amount: sum(fyMonths, (m) => targetMap.get(m.key)?.target_amount ?? 0),
    deals: sum(fyMonths, (m) => targetMap.get(m.key)?.target_deals ?? 0),
    appts: sum(fyMonths, (m) => targetMap.get(m.key)?.target_appointments ?? 0),
    leads: sum(fyMonths, (m) => targetMap.get(m.key)?.target_leads ?? 0),
  };
  const fyActual = {
    amount: sum(fyMonths, (m) => fiscalByKey.get(m.key)?.revenue ?? 0),
    deals: sum(fyMonths, (m) => fiscalByKey.get(m.key)?.deals ?? 0),
    appts: sum(fyMonths, (m) => fiscalByKey.get(m.key)?.appts ?? 0),
    leads: sum(fyMonths, (m) => leadMetrics.byMonth.get(m.key) ?? 0),
  };
  const fyRate = (a: number, t: number) => (t > 0 ? a / t : null);

  const trendData: TrendPoint[] = fyMonths.map((m) => {
    const fr = fiscalByKey.get(m.key);
    const t = targetMap.get(m.key);
    const appts = fr?.appts ?? 0;
    const deals = fr?.deals ?? 0;
    return {
      label: m.label,
      leads: leadMetrics.byMonth.get(m.key) ?? 0,
      appts,
      deals,
      revenue: fr?.revenue ?? 0,
      closeRate: appts > 0 ? Math.round((deals / appts) * 100) : null,
      tLeads: t?.target_leads ?? 0,
      tAppts: t?.target_appointments ?? 0,
      tDeals: t?.target_deals ?? 0,
      tAmount: t?.target_amount ?? 0,
      wRevenue: fr?.wrevenue ?? 0,
    };
  });

  // ファネル(リード起点): リード→アポ獲得→受注。獲得月でコホート集計(集計値のみ使用)。
  //   アポ = 決着がアポ獲得のリード / 成約 = そのリードに紐づく案件が受注(won)
  const thisKey = monthKey(startOfMonth(now));
  const lastKey = monthKey(addMonths(startOfMonth(now), -1));
  // 「累計」は選択年度の合計(年度内12ヶ月の合算)。全期間ではなく年度スコープにする。
  const sumOverFy = (m: Map<string, number>) => fyMonths.reduce((s, fm) => s + (m.get(fm.key) ?? 0), 0);
  const funnelMonth = (k: string) => ({
    leads: leadMetrics.byMonth.get(k) ?? 0,
    appts: leadMetrics.apptByMonth.get(k) ?? 0,
    deals: leadMetrics.wonByMonth.get(k) ?? 0,
  });
  const funnelData = {
    total: {
      leads: sumOverFy(leadMetrics.byMonth),
      appts: sumOverFy(leadMetrics.apptByMonth),
      deals: sumOverFy(leadMetrics.wonByMonth),
    },
    lastMonth: funnelMonth(lastKey),
    thisMonth: funnelMonth(thisKey),
  };

  return (
    <div>
      <PageHeader
        title="ダッシュボード"
        subtitle="今月の着地と打ち手を一目で。未来の売上を作るための起点です。"
        action={<FyTabs years={availableYears} selected={fy} currentFy={currentFy} />}
      />

      {/* 要対応アラート（放置・入力漏れ・フォロー漏れの検知） */}
      {alertRows.length > 0 && (
        <div className="card card-pad mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <AlertTriangle size={15} className="text-accent-orange" />
            <span className="text-sm font-semibold text-ink">要対応アラート</span>
            <span className="text-xs text-ink/40">放置・入力漏れ・フォロー漏れ</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {alertRows.map((a) => (
              <Link
                key={a.kind}
                href={a.link}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  a.severity === "high"
                    ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                    : a.severity === "mid"
                      ? "border-amber-200 bg-amber-50 text-accent-orange hover:bg-amber-100"
                      : "border-black/10 bg-white text-ink/55 hover:bg-mist-soft"
                }`}
              >
                {a.label}
                <span className="tabular-nums font-bold">{a.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

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

      {/* 今年度の進捗 */}
      <Section
        title={`${fiscalYearLabel(fy)}の進捗`}
        className="mb-5"
        action={<Link href="/app/forecast" className="text-xs font-semibold text-teal-primary hover:underline">売上予測 →</Link>}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <FyProgress label="売上" actual={formatYen(fyActual.amount)} target={`目標 ${formatYen(fyTarget.amount)}`} rate={fyRate(fyActual.amount, fyTarget.amount)} />
          <FyProgress label="成約" actual={`${fyActual.deals}件`} target={`目標 ${fyTarget.deals}件`} rate={fyRate(fyActual.deals, fyTarget.deals)} />
          <FyProgress label="アポ" actual={`${fyActual.appts}件`} target={`目標 ${fyTarget.appts}件`} rate={fyRate(fyActual.appts, fyTarget.appts)} />
          <FyProgress label="リード" actual={`${fyActual.leads}件`} target={`目標 ${fyTarget.leads}件`} rate={fyRate(fyActual.leads, fyTarget.leads)} />
        </div>
      </Section>

      {/* 月別推移(実績/予測) + ファネル */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Section
          title="月別 推移（実績と予測）"
          icon={<TargetIcon size={15} />}
          className="lg:col-span-2"
          action={<span className="text-[11px] text-ink/40">棒=実績／線=見込み(予測)・目標</span>}
        >
          <MetricTrendChart data={trendData} />
        </Section>
        <Section title="ファネル分析" action={<span className="text-[11px] text-ink/40">リード起点・獲得月</span>}>
          <FunnelView data={funnelData} totalLabel={`${fy}年度`} />
        </Section>
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

function FyProgress({ label, actual, target, rate }: { label: string; actual: string; target: string; rate: number | null }) {
  const pct = rate != null ? Math.round(rate * 100) : null;
  const reached = rate != null && rate >= 1;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink/60">{label}</span>
        <span className={`text-xs font-bold ${reached ? "text-teal-deep" : "text-accent-orange"}`}>{pct != null ? pct + "%" : "—"}</span>
      </div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{actual}</div>
      <div className="text-[11px] text-ink/40 mb-1.5">{target}</div>
      <ProgressBar value={pct ?? 0} max={100} tone={reached ? "teal" : "orange"} />
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
