import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const roleLabel: Record<string, string> = {
  decision_maker: "決裁者",
  influencer: "影響者",
  user: "利用者",
  referrer: "紹介者",
};
const tempLabel: Record<string, string> = { high: "高", middle: "中", low: "低" };

interface ContactRow {
  id: string;
  name: string;
  account_id: string;
  department: string | null;
  title: string | null;
  decision_role: string | null;
  temperature: string | null;
  email: string | null;
  accounts: { name: string } | null;
}

/** 担当者一覧(E-1軽量化済み: workspace_fullではなく必要列のみ直接取得)。 */
export default async function ContactsPage() {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("contacts")
    .select("id, name, account_id, department, title, decision_role, temperature, email, accounts(name)")
    .order("name")
    .limit(2000);
  const contacts = (data ?? []) as unknown as ContactRow[];

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
            {contacts.map((c) => (
              <tr key={c.id} className="row-hover">
                <td className="td font-medium">{c.name}</td>
                <td className="td"><Link href={`/app/accounts/${c.account_id}`} className="text-teal-deep hover:underline text-sm">{c.accounts?.name}</Link></td>
                <td className="td text-xs text-ink/60">{c.department} / {c.title}</td>
                <td className="td text-xs">{c.decision_role ? roleLabel[c.decision_role] : "—"}</td>
                <td className="td text-xs">{c.temperature ? tempLabel[c.temperature] : "—"}</td>
                <td className="td text-xs text-ink/60">{c.email ?? "—"}</td>
              </tr>
            ))}
            {contacts.length === 0 && <tr><td colSpan={6} className="td text-center text-ink/40 py-10">担当者がいません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
