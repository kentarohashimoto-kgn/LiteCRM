import Link from "next/link";
import { Plus } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { listAccounts, listOpportunities, getContactsByAccount } from "@/lib/data/select";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { formatYen, groupBy, sum } from "@/lib/utils";

const statusLabel: Record<string, string> = { prospect: "見込み", customer: "顧客", inactive: "休眠" };

export default async function AccountsPage() {
  const ws = await getWorkspace();
  const accounts = listAccounts(ws);
  const opps = listOpportunities(ws);
  const oppByAcc = groupBy(opps, (o) => o.account_id);

  return (
    <div>
      <PageHeader
        title="顧客"
        subtitle="会社単位で顧客・見込み顧客を管理します。"
        action={<LinkButton href="/app/accounts/new" variant="accent"><Plus size={16} /> 顧客を追加</LinkButton>}
      />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">会社名</th>
              <th className="th">業種</th>
              <th className="th">エリア</th>
              <th className="th">区分</th>
              <th className="th">優先度</th>
              <th className="th text-right">案件数</th>
              <th className="th text-right">進行中金額</th>
              <th className="th text-right">担当者</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {accounts.map((a) => {
              const list = oppByAcc[a.id] ?? [];
              const open = list.filter((o) => o.status === "open");
              const contacts = getContactsByAccount(ws, a.id);
              return (
                <tr key={a.id} className="row-hover">
                  <td className="td"><Link href={`/app/accounts/${a.id}`} className="font-medium text-ink hover:text-teal-deep">{a.name}</Link></td>
                  <td className="td text-xs text-ink/60">{a.industry ?? "—"}</td>
                  <td className="td text-xs text-ink/60">{a.area ?? "—"}</td>
                  <td className="td"><Tag tone={a.status === "customer" ? "teal" : "gray"}>{statusLabel[a.status]}</Tag></td>
                  <td className="td"><span className="text-sm font-medium">{a.priority ?? "—"}</span></td>
                  <td className="td text-right tabular-nums">{list.length}</td>
                  <td className="td text-right tabular-nums font-semibold">{formatYen(sum(open, (o) => o.amount))}</td>
                  <td className="td text-right text-xs text-ink/60">{contacts.length}名</td>
                </tr>
              );
            })}
            {accounts.length === 0 && <tr><td colSpan={8} className="td text-center text-ink/40 py-10">顧客がありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
