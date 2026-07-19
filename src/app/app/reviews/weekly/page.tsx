import Link from "next/link";
import { CalendarCheck, TrendingUp, AlertTriangle, Target, Pause } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { StageHistory } from "@/lib/types";
import { getSalesTargets, getStageHistory, listOpportunities } from "@/lib/data/select";
import { getLeadMetrics } from "@/lib/data/leads";
import { buildForecast } from "@/lib/forecast";
import { isAtRisk, isStale } from "@/lib/risk";
import { repMetrics, productMetrics, channelMetrics } from "@/lib/analytics";
import { PageHeader, Section, Card, ProgressBar } from "@/components/ui/primitives";
import { OppMiniList } from "@/components/opportunities/opp-mini-list";
import { STAGES } from "@/lib/constants";
import { formatYen, formatPercent, sameMonth, daysSince } from "@/lib/utils";

const stageOrder = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

export default async function WeeklyReviewPage() {
  // E-1軽量化: full(2.1MB)ではなく lite＋直近60日のステージ履歴のみ直接取得
  const lite = await getWorkspaceLite();
  const sb = getSupabaseServer();
  const { data: histRows } = await sb
    .from("stage_histories")
    .select("*")
    .gte("changed_at", new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString())
    .limit(5000);
  const ws = { ...lite, stageHistories: (histRows ?? []) as StageHistory[] };
  const now = new Date();
  const opps = listOpportunities(ws);
  const open = opps.filter((o) => o.status === "open");
  const targets = getSalesTargets(ws);
  const buckets = buildForecast(opps, targets, 3, now);
  const thisMonth = buckets[0];
  const nextMonth = buckets[1];

  // 今週進んだ / 止まった案件
  const progressed = open.filter((o) => {
    const hist = getStageHistory(ws, o.id);
    return hist.some(
      (h) =>
        daysSince(h.changed_at, now)! <= 7 &&
        h.from_stage &&
        (stageOrder[h.to_stage] ?? 0) > (stageOrder[h.from_stage] ?? 0),
    );
  });
  const stalled = open.filter((o) => isStale(o, now)).sort((a, b) => b.amount - a.amount);
  const risky = open.filter((o) => isAtRisk(o, now)).sort((a, b) => b.amount - a.amount);
  const closing = open
    .filter((o) => sameMonth(o.expected_close_date, now))
    .sort((a, b) => b.amount - a.amount);

  const reps = repMetrics(open);
  const products = productMetrics(open).slice(0, 6);
  const channels = channelMetrics(open, (await getLeadMetrics(opps)).bySource).slice(0, 6);
  const achieve = thisMonth.target > 0 ? thisMonth.bestCase / thisMonth.target : 0;

  return (
    <div>
      <PageHeader
        title="週次レビュー"
        subtitle="「確認」で終わらせない。今週の打ち手を決めるための会議画面です。"
        action={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs font-semibold">
            <Link href="/app/reviews/yomi-history" className="text-teal-primary hover:underline">ヨミ変更履歴 →</Link>
            <Link href="/app/reviews/snapshots" className="text-teal-primary hover:underline">週報スナップショット →</Link>
          </div>
        }
      />

      {/* 着地見込み */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <Section title="今月着地見込み" icon={<Target size={15} />}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatMini label="目標" value={thisMonth.target} />
            <StatMini label="Commit" value={thisMonth.commit} tone="teal" />
            <StatMini label="Best Case込み" value={thisMonth.bestCase} />
            <StatMini label="Gap" value={thisMonth.gap} tone={thisMonth.gap >= 0 ? "teal" : "orange"} />
          </div>
          <ProgressBar value={thisMonth.bestCase} max={thisMonth.target} tone={achieve >= 1 ? "teal" : "orange"} />
          <p className="text-xs text-ink/50 mt-2">達成度 {Math.round(achieve * 100)}% ・ {thisMonth.gap >= 0 ? "目標到達ペース" : `${formatYen(Math.abs(thisMonth.gap))} 不足`}</p>
        </Section>
        <Section title="来月パイプライン" icon={<TrendingUp size={15} />}>
          <div className="grid grid-cols-2 gap-3">
            <StatMini label="目標" value={nextMonth.target} />
            <StatMini label="Commit" value={nextMonth.commit} tone="teal" />
            <StatMini label="Best Case込み" value={nextMonth.bestCase} />
            <StatMini label="Pipeline" value={nextMonth.pipeline} />
          </div>
          <p className="text-xs text-ink/50 mt-3">{nextMonth.gap < 0 ? `来月は ${formatYen(Math.abs(nextMonth.gap))} 不足。新規創出が必要です。` : "来月は目標を満たすパイプラインがあります。"}</p>
        </Section>
      </div>

      {/* 案件3カラム */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Section title="今週進んだ案件" icon={<TrendingUp size={15} className="text-teal-primary" />} action={<span className="pill bg-teal-light text-teal-deep">{progressed.length}</span>}>
          <OppMiniList opps={progressed} limit={6} emptyMessage="今週ステージアップした案件はありません" />
        </Section>
        <Section title="今週止まった案件" icon={<Pause size={15} className="text-ink/50" />} action={<span className="pill bg-mist-soft text-ink/60">{stalled.length}</span>}>
          <OppMiniList opps={stalled} showRisk limit={6} emptyMessage="停滞案件はありません" />
        </Section>
        <Section title="クロージング対象(今月)" icon={<Target size={15} className="text-accent-orange" />} action={<span className="pill bg-amber-50 text-accent-orange">{closing.length}</span>}>
          <OppMiniList opps={closing} limit={6} emptyMessage="今月受注予定の案件はありません" />
        </Section>
      </div>

      {/* 危険案件 */}
      <Section title="危険案件(代表支援・打ち手の検討対象)" icon={<AlertTriangle size={15} className="text-rose-500" />} className="mb-5" action={<span className="pill bg-rose-100 text-rose-600">{risky.length}件</span>}>
        <OppMiniList opps={risky} showRisk emptyMessage="危険案件はありません" />
      </Section>

      {/* 状況サマリー */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Section title="営業マン別状況">
          <MiniTable
            head={["担当", "進行中", "次AC率", "放置"]}
            rows={reps.map((r) => [r.name, formatYen(r.openAmount), formatPercent(r.nextActionRate), `${r.staleCount}`])}
          />
        </Section>
        <Section title="商品別状況">
          <MiniTable
            head={["商品", "進行中", "成約率"]}
            rows={products.map((p) => [p.name, formatYen(p.openAmount), formatPercent(p.winRate)])}
          />
        </Section>
        <Section title="流入経路別状況">
          <MiniTable
            head={["経路", "案件", "成約率"]}
            rows={channels.map((c) => [c.name, `${c.oppCount}件`, formatPercent(c.winRate)])}
          />
        </Section>
      </div>

      {/* 今週の施策 */}
      <Section title="今週の施策(会議で決めること)" icon={<CalendarCheck size={15} />}>
        <ul className="space-y-2 text-sm text-ink/70">
          <li className="flex gap-2"><span className="text-teal-primary font-bold">①</span> どの危険案件を代表が支援するか</li>
          <li className="flex gap-2"><span className="text-teal-primary font-bold">②</span> どの案件を今週クロージングするか（クロージング対象 {closing.length}件）</li>
          <li className="flex gap-2"><span className="text-teal-primary font-bold">③</span> どの商品を重点提案するか</li>
          <li className="flex gap-2"><span className="text-teal-primary font-bold">④</span> どの流入経路に追加施策を打つか</li>
          <li className="flex gap-2"><span className="text-teal-primary font-bold">⑤</span> どの営業担当に支援が必要か（放置案件の多い担当）</li>
          <li className="flex gap-2"><span className="text-teal-primary font-bold">⑥</span> 来月の不足 {nextMonth.gap < 0 ? formatYen(Math.abs(nextMonth.gap)) : "なし"} をどう埋めるか</li>
        </ul>
        <p className="text-xs text-ink/40 mt-4">将来：この内容をAIが自動要約し、施策候補を提案します。</p>
      </Section>
    </div>
  );
}

function StatMini({ label, value, tone }: { label: string; value: number; tone?: "teal" | "orange" }) {
  return (
    <div>
      <div className="text-xs text-ink/50">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone === "orange" ? "stat-accent" : tone === "teal" ? "text-teal-deep" : "text-ink"}`}>{formatYen(value)}</div>
    </div>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-sm text-ink/40 py-2">データがありません</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr>{head.map((h, i) => <th key={h} className={`th ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-black/[0.04]">
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((c, ci) => <td key={ci} className={`td ${ci > 0 ? "text-right tabular-nums" : "font-medium"}`}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
