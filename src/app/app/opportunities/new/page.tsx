import Link from "next/link";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getLeadSources, getProducts, listMembers } from "@/lib/data/select";
import { CATEGORIES, DEAL_PHASES, YOMI_OPTIONS } from "@/lib/constants";
import { PageHeader } from "@/components/ui/primitives";
import { createOpportunityAction } from "@/server/actions";
import { type SourceDetailOption } from "@/components/opportunities/source-select";
import { OppCustomerSection } from "@/components/opportunities/opp-customer-section";
import { getSupabaseServer } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function NewOpportunityPage({ searchParams }: { searchParams: { error?: string } }) {
  const ws = await getWorkspaceLite();
  const owners = listMembers(ws).map(({ user }) => user);
  const products = getProducts(ws);
  const sources = getLeadSources(ws);
  const { data: detailRows } = await getSupabaseServer()
    .from("lead_source_details")
    .select("id, lead_source_id, name")
    .eq("status", "active")
    .order("sort_order")
    .order("name");
  const sourceDetails = (detailRows ?? []) as SourceDetailOption[];

  return (
    <div className="max-w-2xl">
      <PageHeader title="案件を作成" subtitle="顧客を選ぶか、その場で新規登録して案件を作成します。リードからの起票なら顧客・担当者・流入情報を引き継ぎます。" />
      {searchParams.error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{searchParams.error}</div>
      )}
      <form action={createOpportunityAction} className="card card-pad space-y-4">
        <OppCustomerSection sources={sources.map((s) => ({ id: s.id, name: s.name }))} details={sourceDetails} />
        <div>
          <label className="label">担当営業 *</label>
          <select name="owner_user_id" required defaultValue={ws.ctx.userId} className="input">
            {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">ヨミ</label>
            <select name="yomi" defaultValue="4.アポ" className="input">
              {YOMI_OPTIONS.filter((y) => !y.key.startsWith("0") && !y.key.startsWith("7") && !y.key.startsWith("8")).map((y) => (
                <option key={y.key} value={y.key}>{y.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">主商材</label>
            <select name="primary_product_id" className="input">
              <option value="">選択してください</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">分類</label>
            <select name="category" className="input" defaultValue="">
              <option value="">選択してください</option>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">見込み金額(円)</label>
            <input name="amount" type="number" className="input" placeholder="1500000" />
          </div>
        </div>
        <p className="text-[11px] text-ink/40">※ ステージ・予測区分はヨミから自動設定されます。</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">案件予測 *</label>
            <select name="deal_phase" required className="input" defaultValue="">
              <option value="" disabled>選択してください</option>
              {DEAL_PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">受注見込み時期 *</label>
            <input name="expected_revenue_month" type="month" required className="input" />
          </div>
          <div>
            <label className="label">受注予定日(任意)</label>
            <input name="expected_close_date" type="date" className="input" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">次回アクション日 *</label>
            <input name="next_action_date" type="date" required className="input" />
          </div>
          <div>
            <label className="label">次回アクション内容 *</label>
            <input name="next_action_text" required className="input" placeholder="例：提案書を送付し打合せ日程を調整" />
          </div>
        </div>
        <div>
          <label className="label">メモ</label>
          <textarea name="notes" rows={3} className="input" />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <SubmitButton className="btn-primary" pendingLabel="作成中…">案件を作成</SubmitButton>
          <Link href="/app/opportunities" className="btn-ghost">キャンセル</Link>
        </div>
      </form>
    </div>
  );
}
