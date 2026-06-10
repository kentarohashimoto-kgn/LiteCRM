import { getWorkspace } from "@/lib/data/workspace";
import { getAccount, getLeadSource, getLeadSources, getProducts, getUser, listAccounts, listLeads, listMembers } from "@/lib/data/select";
import { PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { createLeadAction } from "@/server/actions";
import { formatDate } from "@/lib/utils";

const statusLabel: Record<string, string> = {
  new: "新規",
  contacted: "対応中",
  qualified: "案件化候補",
  disqualified: "対象外",
  converted: "案件化済",
};
const statusTone: Record<string, "teal" | "orange" | "gray"> = {
  new: "orange",
  contacted: "teal",
  qualified: "teal",
  disqualified: "gray",
  converted: "teal",
};

export default async function LeadsPage() {
  const ws = await getWorkspace();
  const leads = listLeads(ws);
  const accounts = listAccounts(ws);
  const sources = getLeadSources(ws);
  const products = getProducts(ws);
  const owners = listMembers(ws).map(({ user }) => user);

  return (
    <div>
      <PageHeader title="リード" subtitle="X・紹介・展示会・LP・ウェビナー等から獲得したリードを管理します。" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-black/[0.06]">
              <tr>
                <th className="th">リード名</th>
                <th className="th">流入経路</th>
                <th className="th">担当</th>
                <th className="th">状態</th>
                <th className="th">ランク</th>
                <th className="th">獲得日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {leads.map((l) => (
                <tr key={l.id} className="row-hover">
                  <td className="td">
                    <div className="font-medium text-sm">{l.title}</div>
                    {l.account_id && <div className="text-xs text-ink/45">{getAccount(ws, l.account_id)?.name}</div>}
                  </td>
                  <td className="td text-xs">{getLeadSource(ws, l.lead_source_id)?.name ?? "—"}</td>
                  <td className="td"><div className="flex items-center gap-1.5"><Avatar user={getUser(ws, l.owner_user_id)} size={20} /><span className="text-xs">{getUser(ws, l.owner_user_id)?.name}</span></div></td>
                  <td className="td"><Tag tone={statusTone[l.status]}>{statusLabel[l.status]}</Tag></td>
                  <td className="td text-sm">{l.rank ?? "—"}</td>
                  <td className="td text-xs text-ink/60">{formatDate(l.acquired_at)}</td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={6} className="td text-center text-ink/40 py-10">リードがありません</td></tr>}
            </tbody>
          </table>
        </div>

        <Section title="リードを追加">
          <form action={createLeadAction} className="space-y-3">
            <div><label className="label">リード名 *</label><input name="title" required className="input" placeholder="例：展示会経由 物流DX相談" /></div>
            <div><label className="label">流入経路</label>
              <select name="lead_source_id" className="input"><option value="">—</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>
            <div><label className="label">関心商材</label>
              <select name="primary_product_id" className="input"><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </div>
            <div><label className="label">会社(任意)</label>
              <select name="account_id" className="input"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">担当</label>
                <select name="owner_user_id" defaultValue={ws.ctx.userId} className="input">{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </div>
              <div><label className="label">ランク</label>
                <select name="rank" className="input"><option value="">—</option><option>A</option><option>B</option><option>C</option></select>
              </div>
            </div>
            <button type="submit" className="btn-accent w-full">追加する</button>
          </form>
        </Section>
      </div>
    </div>
  );
}
