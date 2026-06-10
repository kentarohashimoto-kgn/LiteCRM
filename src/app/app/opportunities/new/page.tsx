import Link from "next/link";
import { getWorkspace } from "@/lib/data/workspace";
import { getLeadSources, getProducts, listAccounts, listMembers } from "@/lib/data/select";
import { STAGES, FORECAST_CATEGORIES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/primitives";
import { createOpportunityAction } from "@/server/actions";

export default async function NewOpportunityPage() {
  const ws = await getWorkspace();
  const accounts = listAccounts(ws);
  const owners = listMembers(ws).map(({ user }) => user);
  const products = getProducts(ws);
  const sources = getLeadSources(ws);

  return (
    <div className="max-w-2xl">
      <PageHeader title="案件を作成" subtitle="新しい案件を登録します。" />
      <form action={createOpportunityAction} className="card card-pad space-y-4">
        <div>
          <label className="label">案件名 *</label>
          <input name="name" required className="input" placeholder="例：株式会社○○ / 生成AI企業研修" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">顧客 *</label>
            <select name="account_id" required className="input">
              <option value="">選択してください</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">担当営業 *</label>
            <select name="owner_user_id" required defaultValue={ws.ctx.userId} className="input">
              {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">主商材</label>
            <select name="primary_product_id" className="input">
              <option value="">選択してください</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">流入経路</label>
            <select name="lead_source_id" className="input">
              <option value="">選択してください</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">ステージ</label>
            <select name="stage" defaultValue="lead_acquired" className="input">
              {STAGES.filter((s) => s.group === "open").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">ヨミ</label>
            <select name="forecast_category" defaultValue="pipeline" className="input">
              {FORECAST_CATEGORIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">見込み金額(円)</label>
            <input name="amount" type="number" className="input" placeholder="1500000" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">受注予定日</label>
            <input name="expected_close_date" type="date" className="input" />
          </div>
          <div>
            <label className="label">次アクション日</label>
            <input name="next_action_date" type="date" className="input" />
          </div>
        </div>
        <div>
          <label className="label">次アクション内容</label>
          <input name="next_action_text" className="input" placeholder="例：提案書を送付し打合せ日程を調整" />
        </div>
        <div>
          <label className="label">メモ</label>
          <textarea name="notes" rows={3} className="input" />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <button type="submit" className="btn-primary">案件を作成</button>
          <Link href="/app/opportunities" className="btn-ghost">キャンセル</Link>
        </div>
      </form>
    </div>
  );
}
