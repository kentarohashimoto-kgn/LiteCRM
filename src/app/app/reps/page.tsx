import Link from "next/link";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listOpportunities, listMembers, listAccounts, listRepTargets } from "@/lib/data/select";
import { PageHeader } from "@/components/ui/primitives";
import { formatYen, startOfMonth, addMonths, monthKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RepsPage() {
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => user);
  const opps = listOpportunities(ws);
  const accounts = listAccounts(ws);
  const repTargets = listRepTargets(ws);
  const now = new Date();
  const nextKey = monthKey(startOfMonth(addMonths(now, 1)));

  const rows = members
    .map((u) => {
      const myOpps = opps.filter((o) => o.owner_user_id === u.id);
      const open = myOpps.filter((o) => o.status === "open");
      const myAccounts = accounts.filter((a) => a.owner_user_id === u.id);
      const nextTarget = repTargets.find((t) => t.user_id === u.id && t.target_month === nextKey)?.target_amount ?? 0;
      return {
        id: u.id,
        name: u.name,
        accounts: myAccounts.length,
        openCount: open.length,
        openAmount: open.reduce((s, o) => s + o.amount, 0),
        weighted: open.reduce((s, o) => s + o.weighted, 0),
        nextTarget,
      };
    })
    .sort((a, b) => b.openAmount - a.openAmount);

  return (
    <div>
      <PageHeader title="営業ビュー" subtitle="営業ごとの担当顧客・案件・見込み・次月目標。名前をクリックで個人ダッシュボードへ。" />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">営業</th>
              <th className="th text-right">担当顧客</th>
              <th className="th text-right">進行中案件</th>
              <th className="th text-right">進行中見込</th>
              <th className="th text-right">Weighted</th>
              <th className="th text-right">次月目標</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td">
                  <Link href={`/app/reps/${r.id}`} className="font-medium text-ink hover:text-teal-deep">{r.name}</Link>
                </td>
                <td className="td text-right tabular-nums">{r.accounts}</td>
                <td className="td text-right tabular-nums">{r.openCount}</td>
                <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(r.openAmount)}</td>
                <td className="td text-right tabular-nums text-teal-deep">{formatYen(r.weighted)}</td>
                <td className="td text-right tabular-nums text-ink/60">{r.nextTarget > 0 ? formatYen(r.nextTarget) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
