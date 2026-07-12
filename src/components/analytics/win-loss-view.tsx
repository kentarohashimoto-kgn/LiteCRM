import { Section, StatCard, EmptyState } from "@/components/ui/primitives";
import { formatYen, formatPercent, formatDate, cn } from "@/lib/utils";
import type { WinLossData, Grouped } from "@/lib/data/win-loss";

function GroupedTable({ rows, keyLabel }: { rows: Grouped[]; keyLabel: string }) {
  if (rows.length === 0) return <EmptyState message="該当データがありません。" />;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums" style={{ minWidth: 420 }}>
        <thead>
          <tr>
            <th className="th">{keyLabel}</th>
            <th className="th text-right">件数</th>
            <th className="th">構成</th>
            <th className="th text-right">金額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="row-hover border-t border-black/[0.04]">
              <td className="td whitespace-normal max-w-[280px]">{r.key}</td>
              <td className="td text-right font-semibold">{r.count}</td>
              <td className="td">
                <div className="h-2 w-full rounded-full bg-mist-soft overflow-hidden" style={{ maxWidth: 160 }}>
                  <div className="h-full rounded-full bg-rose-400" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </td>
              <td className="td text-right text-ink/70">{formatYen(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WinLossView({ data }: { data: WinLossData }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="成約" raw={`${data.wonCount}`} sub="件" accent />
        <StatCard label="成約金額" amount={data.wonAmount} />
        <StatCard label="失注" raw={`${data.lostCount}`} sub="件" />
        <StatCard label="勝率" raw={formatPercent(data.winRate)} sub="成約 / (成約+失注)" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="失注理由別（構造化コード）">
          <GroupedTable rows={data.lostByReason} keyLabel="理由コード" />
          <p className="mt-2 text-xs text-ink/45">「未分類」が多い場合は、案件の失注理由コードを付けると精度が上がります（自由記述は下の一覧で確認できます）。</p>
        </Section>
        <Section title="競合別 失注">
          <GroupedTable rows={data.lostByCompetitor} keyLabel="競合" />
        </Section>
      </div>

      <Section title="カテゴリ別 勝率">
        {data.byCategory.length === 0 ? (
          <EmptyState message="データがありません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th className="th">カテゴリ</th>
                  <th className="th text-right">成約</th>
                  <th className="th text-right">失注</th>
                  <th className="th text-right">勝率</th>
                </tr>
              </thead>
              <tbody>
                {data.byCategory.map((c) => (
                  <tr key={c.category} className="row-hover border-t border-black/[0.04]">
                    <td className="td">{c.category}</td>
                    <td className="td text-right text-emerald-600 font-medium">{c.won}</td>
                    <td className="td text-right text-rose-600">{c.lost}</td>
                    <td className="td text-right font-semibold">{formatPercent(c.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="最近の失注（理由の生記録）">
        {data.recentLost.length === 0 ? (
          <EmptyState message="失注案件がありません。" />
        ) : (
          <div className="space-y-2">
            {data.recentLost.map((r) => (
              <div key={r.id} className="rounded-lg border border-black/[0.06] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-ink truncate">
                    {r.account ? <span className="text-ink/50">{r.account}／</span> : null}
                    {r.name}
                  </div>
                  <div className="text-xs text-ink/40 shrink-0">
                    {formatDate(r.closedAt)} ・ {formatYen(r.amount)}
                  </div>
                </div>
                {r.reason && <div className={cn("mt-1 text-sm text-ink/70 whitespace-pre-wrap leading-relaxed line-clamp-4")}>{r.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
