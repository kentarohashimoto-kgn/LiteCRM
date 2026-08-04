import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listOpportunities, listMembers, listAccounts, getSalesTargets, listRepTargets } from "@/lib/data/select";
import { PageHeader, Section, StatCard, ProgressBar, Avatar } from "@/components/ui/primitives";
import { YomiBadge } from "@/components/ui/badges";
import { buildFunnel } from "@/lib/reps";
import { formatYen, formatDate, startOfMonth, addMonths, monthKey, sum, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RepDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ws = await getWorkspaceLite();
  const member = listMembers(ws).find(({ user }) => user.id === params.id);
  if (!member) notFound();
  const user = member.user;

  const opps = listOpportunities(ws).filter((o) => o.owner_user_id === user.id);
  const open = opps.filter((o) => o.status === "open");
  const accounts = listAccounts(ws).filter((a) => a.owner_user_id === user.id);
  const salesTargets = getSalesTargets(ws);
  const repTargets = listRepTargets(ws);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nextKey = monthKey(startOfMonth(addMonths(now, 1)));
  const nextLabel = `${nextKey.slice(0, 4)}年${Number(nextKey.slice(5, 7))}月`;

  // 次月: 組織目標 と 自分の目標(金額)
  const orgTarget = salesTargets.find((t) => t.target_month === nextKey);
  const selfTarget = repTargets.find((t) => t.user_id === user.id && t.target_month === nextKey)?.target_amount ?? 0;

  // 次月に受注見込みの自分の案件（見込み時期=次月）
  const nextMonthOpen = open.filter((o) => (o.expected_revenue_month ?? o.expected_close_date ?? "").slice(0, 7) === nextKey.slice(0, 7));
  const nextWeighted = sum(nextMonthOpen, (o) => o.weighted);
  const nextCommit = sum(nextMonthOpen.filter((o) => o.forecast_category === "commit"), (o) => o.amount);
  const selfRate = selfTarget > 0 ? nextWeighted / selfTarget : null;

  const funnel = buildFunnel(opps);
  const funnelMax = Math.max(1, ...funnel.buckets.map((b) => b.count));

  // 商談予定（次回アクション日ベース、近い順）
  const schedule = open
    .filter((o) => o.next_action_date)
    .sort((a, b) => (a.next_action_date ?? "").localeCompare(b.next_action_date ?? ""))
    .slice(0, 12);

  // 担当案件（open、金額順）
  const openByAmount = [...open].sort((a, b) => b.amount - a.amount).slice(0, 12);
  // 担当顧客（進行中見込み順）
  const accOpen = new Map<string, number>();
  for (const o of open) accOpen.set(o.account_id, (accOpen.get(o.account_id) ?? 0) + o.amount);
  const accountsSorted = [...accounts].sort((a, b) => (accOpen.get(b.id) ?? 0) - (accOpen.get(a.id) ?? 0)).slice(0, 12);

  return (
    <div>
      <Link href="/app/reps" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 営業ビュー
      </Link>
      <PageHeader title={`${user.name} の営業ダッシュボード`} subtitle="担当顧客・案件・商談予定と、次月の目標・KPI・案件ファネル。" />

      {/* 次月の目標(組織 vs 自分) */}
      <Section title={`${nextLabel}の目標とKPI`} className="mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="組織 売上目標" amount={orgTarget?.target_amount ?? 0} />
          <StatCard label="自分 売上目標" amount={selfTarget} accent />
          <StatCard label="自分 次月見込(Weighted)" raw={formatYen(Math.round(nextWeighted))} sub={`Commit ${formatYen(nextCommit)}`} />
          <StatCard label="組織 成約/アポ/リード目標" raw={`${orgTarget?.target_deals ?? 0} / ${orgTarget?.target_appointments ?? 0} / ${orgTarget?.target_leads ?? 0}`} />
        </div>
        {selfTarget > 0 && (
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-1.5 text-sm">
              <span className="font-semibold text-ink">自分の目標に対する見込み</span>
              <span className="tabular-nums">
                <span className="font-bold text-teal-deep">{formatYen(Math.round(nextWeighted))}</span>
                <span className="text-ink/40"> / {formatYen(selfTarget)}</span>
                <span className={cn("ml-2 font-bold", selfRate != null && selfRate >= 1 ? "text-teal-deep" : "text-accent-orange")}>
                  {selfRate != null ? Math.round(selfRate * 100) + "%" : "—"}
                </span>
              </span>
            </div>
            <ProgressBar value={nextWeighted} max={selfTarget} tone={selfRate != null && selfRate >= 1 ? "teal" : "orange"} />
            <p className="text-[11px] text-ink/45 mt-1.5">
              {selfRate != null && selfRate >= 1
                ? "現在の見込みで次月目標に到達するペースです。"
                : "目標到達には追加のパイプライン創出・確度引上げが必要です。"}
            </p>
          </div>
        )}
      </Section>

      {/* 案件ファネル(個人・deal_phase) */}
      <Section title="案件ファネル（案件予測ベース）" className="mb-5" action={<span className="text-[11px] text-ink/40">進行中案件の段階分布</span>}>
        <div className="space-y-1.5">
          {funnel.buckets.map((b) => (
            <div key={b.phase} className="flex items-center gap-3">
              <span className="w-16 text-xs text-ink/60 shrink-0">{b.label}</span>
              <div className="flex-1 h-6 rounded bg-mist-soft overflow-hidden">
                <div className="h-full bg-teal-primary/70 flex items-center px-2" style={{ width: `${Math.max(4, (b.count / funnelMax) * 100)}%` }}>
                  <span className="text-[10px] font-bold text-white tabular-nums">{b.count}</span>
                </div>
              </div>
              <span className="w-24 text-right text-xs tabular-nums text-ink/60 shrink-0">{formatYen(b.amount)}</span>
            </div>
          ))}
          <div className="flex flex-wrap gap-4 pt-2 text-xs text-ink/55">
            <span>未来客: <b className="text-ink">{funnel.future.count}</b>（{formatYen(funnel.future.amount)}）</span>
            <span>案件予測 未設定: <b className="text-accent-orange">{funnel.unset.count}</b></span>
            <span>受注(累計): <b className="text-teal-deep">{funnel.won.count}</b>（{formatYen(funnel.won.amount)}）</span>
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* 商談予定 */}
        <Section title="商談予定（次回アクション）" action={<span className="pill bg-teal-light text-teal-deep">{schedule.length}</span>}>
          {schedule.length === 0 ? (
            <p className="text-sm text-ink/40 py-6 text-center">予定はありません</p>
          ) : (
            <ul className="divide-y divide-black/[0.04]">
              {schedule.map((o) => {
                const overdue = (o.next_action_date ?? "") < todayStr;
                return (
                  <li key={o.id} className="py-2 flex items-center gap-2">
                    <span className={cn("text-xs tabular-nums shrink-0 w-16", overdue ? "text-rose-500 font-medium" : "text-ink/60")}>{formatDate(o.next_action_date)}</span>
                    <Link href={`/app/opportunities/${o.id}`} className="flex-1 min-w-0">
                      <span className="block text-sm text-ink truncate hover:text-teal-deep">{o.account?.name}</span>
                      <span className="block text-xs text-ink/45 truncate">{o.next_action_text ?? o.name}</span>
                    </Link>
                    <YomiBadge yomi={o.yomi} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* 担当顧客 */}
        <Section title="担当顧客" action={<span className="pill bg-mist-soft text-ink/50">{accounts.length}</span>}>
          {accountsSorted.length === 0 ? (
            <p className="text-sm text-ink/40 py-6 text-center">担当顧客がありません</p>
          ) : (
            <ul className="divide-y divide-black/[0.04]">
              {accountsSorted.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-2">
                  <Link href={`/app/accounts/${a.id}`} className="text-sm text-ink truncate hover:text-teal-deep min-w-0">{a.name}</Link>
                  <span className="text-xs tabular-nums text-teal-deep shrink-0">{formatYen(accOpen.get(a.id) ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* 担当案件 */}
      <Section title="担当案件（進行中）" action={<span className="pill bg-mist-soft text-ink/50">{open.length}</span>}>
        {openByAmount.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">進行中案件がありません</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-black/[0.06]">
                <tr>
                  <th className="th">顧客 / 案件</th>
                  <th className="th">ヨミ</th>
                  <th className="th text-right">金額</th>
                  <th className="th">見込月</th>
                  <th className="th">次回AC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {openByAmount.map((o) => (
                  <tr key={o.id} className="row-hover">
                    <td className="td max-w-[240px]">
                      <Link href={`/app/opportunities/${o.id}`} className="block">
                        <span className="font-medium text-ink hover:text-teal-deep truncate block">{o.account?.name}</span>
                        <span className="text-xs text-ink/45 truncate block">{o.name}</span>
                      </Link>
                    </td>
                    <td className="td"><YomiBadge yomi={o.yomi} /></td>
                    <td className="td text-right tabular-nums font-semibold">{formatYen(o.amount)}</td>
                    <td className="td text-xs">{o.expected_revenue_month ? o.expected_revenue_month.slice(0, 7) : "—"}</td>
                    <td className="td text-xs">{o.next_action_date ? formatDate(o.next_action_date) : <span className="pill bg-amber-50 text-accent-orange text-[10px]">未設定</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
