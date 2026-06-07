import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { listContacts, getAccount } from "@/lib/data/select";
import { PageHeader } from "@/components/ui/primitives";

const roleLabel: Record<string, string> = {
  decision_maker: "決裁者",
  influencer: "影響者",
  user: "利用者",
  referrer: "紹介者",
};
const tempLabel: Record<string, string> = { high: "高", middle: "中", low: "低" };

export default async function ContactsPage() {
  const ws = await getWorkspace();
  const contacts = listContacts(ws);

  return (
    <div>
      <PageHeader title="担当者" subtitle="顧客企業の担当者(キーパーソン)を管理します。" />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">氏名</th>
              <th className="th">会社</th>
              <th className="th">部署 / 役職</th>
              <th className="th">役割</th>
              <th className="th">温度感</th>
              <th className="th">メール</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {contacts.map((c) => {
              const acc = getAccount(ws, c.account_id);
              return (
                <tr key={c.id} className="row-hover">
                  <td className="td font-medium">{c.name}</td>
                  <td className="td"><Link href={`/app/accounts/${c.account_id}`} className="text-teal-deep hover:underline text-sm">{acc?.name}</Link></td>
                  <td className="td text-xs text-ink/60">{c.department} / {c.title}</td>
                  <td className="td text-xs">{c.decision_role ? roleLabel[c.decision_role] : "—"}</td>
                  <td className="td text-xs">{c.temperature ? tempLabel[c.temperature] : "—"}</td>
                  <td className="td text-xs text-ink/60">{c.email ?? "—"}</td>
                </tr>
              );
            })}
            {contacts.length === 0 && <tr><td colSpan={6} className="td text-center text-ink/40 py-10">担当者がいません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
