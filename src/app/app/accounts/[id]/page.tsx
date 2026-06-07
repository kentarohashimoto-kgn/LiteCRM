import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { getAccount, getContactsByAccount, listOpportunities } from "@/lib/data/select";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { OppMiniList } from "@/components/opportunities/opp-mini-list";
import { formatYen, sum } from "@/lib/utils";

const statusLabel: Record<string, string> = { prospect: "見込み", customer: "顧客", inactive: "休眠" };

export default async function AccountDetailPage({ params }: { params: { id: string } }) {
  const ws = await getWorkspace();
  const account = getAccount(ws, params.id);
  if (!account) notFound();

  const contacts = getContactsByAccount(ws, account.id);
  const opps = listOpportunities(ws).filter((o) => o.account_id === account.id);
  const won = opps.filter((o) => o.status === "won");
  const open = opps.filter((o) => o.status === "open");

  return (
    <div>
      <Link href="/app/accounts" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 顧客一覧
      </Link>
      <PageHeader
        title={account.name}
        subtitle={`${account.industry ?? ""} ${account.area ? "・" + account.area : ""}`}
        action={<Tag tone={account.status === "customer" ? "teal" : "gray"}>{statusLabel[account.status]}</Tag>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">進行中商談</div><div className="stat-value mt-1">{open.length}</div></Card>
        <Card><div className="text-xs text-ink/50">進行中金額</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(sum(open, (o) => o.amount))}</div></Card>
        <Card><div className="text-xs text-ink/50">累計受注額(LTV)</div><div className="text-2xl font-bold mt-1 stat-accent tabular-nums">{formatYen(sum(won, (o) => o.amount))}</div></Card>
        <Card><div className="text-xs text-ink/50">担当者</div><div className="stat-value mt-1">{contacts.length}<span className="stat-unit">名</span></div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="商談" className="lg:col-span-2">
          <OppMiniList opps={opps} emptyMessage="商談はありません" />
        </Section>
        <Section title="担当者">
          {contacts.length === 0 ? (
            <p className="text-sm text-ink/40 py-2">担当者がいません</p>
          ) : (
            <ul className="space-y-3">
              {contacts.map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="font-medium">{c.name} <span className="text-xs text-ink/50">{c.title}</span></div>
                  <div className="text-xs text-ink/50">{c.department} ・ {c.email}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
