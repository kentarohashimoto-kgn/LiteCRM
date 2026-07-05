import Link from "next/link";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listOpportunities, listMembers, listRepTargets } from "@/lib/data/select";
import { repMetrics } from "@/lib/analytics";
import { PageHeader } from "@/components/ui/primitives";
import { RepAnalysis, type RepRow } from "@/components/analytics/rep-analysis";
import { monthKey, startOfMonth, addMonths } from "@/lib/utils";

function ymOf(s?: string | null): string | null {
  if (!s) return null;
  return monthKey(startOfMonth(new Date(s)));
}

export default async function SalesRepAnalyticsPage() {
  const ws = await getWorkspaceLite(); // E-1軽量化: full(2.1MB)→lite
  const opps = listOpportunities(ws);
  const reps = repMetrics(opps);

  const statusByUser = new Map(listMembers(ws).map((m) => [m.user.id, m.repStatus]));

  // 直近12ヶ月
  const now = new Date();
  const cols = Array.from({ length: 12 }, (_, i) => {
    const d = addMonths(startOfMonth(now), i - 11);
    return { key: monthKey(d), label: `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}` };
  });

  // (owner, month) 別の受注額/受注数/アポ
  const rev = new Map<string, number>();
  const deals = new Map<string, number>();
  const appts = new Map<string, number>();
  for (const o of opps) {
    if (o.status === "won" && o.amount) {
      const mk = ymOf(o.expected_close_date || o.expected_revenue_month);
      if (mk) {
        const k = `${o.owner_user_id}|${mk}`;
        rev.set(k, (rev.get(k) ?? 0) + o.amount);
        deals.set(k, (deals.get(k) ?? 0) + 1);
      }
    }
    const fm = ymOf(o.first_meeting_date);
    if (fm) {
      const k = `${o.owner_user_id}|${fm}`;
      appts.set(k, (appts.get(k) ?? 0) + 1);
    }
  }
  const targetMap = new Map(listRepTargets(ws).map((t) => [`${t.user_id}|${t.target_month}`, t.target_amount]));

  const rows: RepRow[] = reps.map((r) => ({
    userId: r.userId,
    name: r.name,
    status: statusByUser.get(r.userId) ?? undefined,
    openCount: r.openCount,
    openAmount: r.openAmount,
    wonCount: r.wonCount,
    wonAmount: r.wonAmount,
    winRate: r.winRate,
    avgDealSize: r.avgDealSize,
    nextActionRate: r.nextActionRate,
    staleCount: r.staleCount,
    months: cols.map((c) => {
      const k = `${r.userId}|${c.key}`;
      return {
        label: c.label,
        revenue: rev.get(k) ?? 0,
        deals: deals.get(k) ?? 0,
        appts: appts.get(k) ?? 0,
        target: targetMap.get(k) ?? 0,
      };
    }),
  }));

  return (
    <div>
      <PageHeader
        title="営業マン別分析"
        subtitle="担当者別の行動量・受注率・単価・放置案件と、月別推移・目標・ステータスを管理します。"
        action={<Link href="/app/targets?scope=rep" className="text-xs font-semibold text-teal-primary hover:underline">月別目標を設定 →</Link>}
      />
      <RepAnalysis rows={rows} />
    </div>
  );
}
