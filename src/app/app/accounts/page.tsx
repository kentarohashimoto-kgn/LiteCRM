import { Plus } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { listAccounts, listOpportunities } from "@/lib/data/select";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { AccountsTable, type AccountRow } from "@/components/accounts/accounts-table";
import { groupBy } from "@/lib/utils";

export default async function AccountsPage() {
  const ws = await getWorkspace();
  const accounts = listAccounts(ws);
  const opps = listOpportunities(ws);
  const oppByAcc = groupBy(opps, (o) => o.account_id);

  const rows: AccountRow[] = accounts.map((a) => {
    const list = oppByAcc[a.id] ?? [];
    const open = list.filter((o) => o.status === "open");
    const won = list.filter((o) => o.status === "won");
    return {
      id: a.id,
      name: a.name,
      industry: a.industry,
      area: a.area,
      status: a.status,
      rank: a.rank,
      focus: a.focus,
      lifetimeRevenue: won.reduce((s, o) => s + o.amount, 0),
      openAmount: open.reduce((s, o) => s + o.amount, 0),
      oppCount: list.length,
      isActive: open.length > 0,
    };
  });

  return (
    <div>
      <PageHeader
        title="顧客"
        subtitle="累積売上の高い順で追客優先度を可視化。ランク・重点フラグで手動の追客管理も。"
        action={<LinkButton href="/app/accounts/new" variant="accent"><Plus size={16} /> 顧客を追加</LinkButton>}
      />
      <AccountsTable rows={rows} />
    </div>
  );
}
