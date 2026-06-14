import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { updateLeadAction, deleteLeadAction } from "@/server/actions";
import { PromoteLeadButton } from "@/components/leads/promote-button";
import { LEAD_DISPOSITIONS } from "@/lib/constants";
import { ROLE_LEVELS, NEEDS_OPTS, TIMING_OPTS, AUTHORITY_OPTS, BUDGET_OPTS, REVENUE_OPTS } from "@/lib/lead-import";

export default async function LeadEditPage({ params }: { params: { id: string } }) {
  const ws = await getWorkspace();
  const l = ws.leads.find((x) => x.id === params.id);
  if (!l) notFound();
  const ev = l.raw_event ?? "—";
  const converted = !!l.account_id || l.status === "converted";
  const linkedOpp = ws.opportunities.find((o) => o.lead_id === l.id);

  return (
    <div className="max-w-3xl">
      <Link href="/app/leads" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> リード一覧
      </Link>
      <PageHeader
        title={l.company_name ?? "リード"}
        subtitle={`${l.contact_name ?? ""}｜流入: ${ev}｜優先度 ${l.priority_score ?? 0}`}
        action={
          converted ? (
            linkedOpp ? (
              <Link href={`/app/opportunities/${linkedOpp.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-deep hover:underline">案件化済み｜商談を開く →</Link>
            ) : (
              <span className="pill bg-teal-light text-teal-deep">案件化済み</span>
            )
          ) : (
            <PromoteLeadButton leadId={l.id} />
          )
        }
      />

      <form action={updateLeadAction} className="space-y-5">
        <input type="hidden" name="id" value={l.id} />
        <input type="hidden" name="priority_base" value={l.priority_base ?? 20} />

        <Section title="基本情報">
          <div className="grid grid-cols-2 gap-4">
            <F label="会社名"><input name="company_name" defaultValue={l.company_name ?? ""} className="input" /></F>
            <F label="氏名"><input name="contact_name" defaultValue={l.contact_name ?? ""} className="input" /></F>
            <F label="メール"><input name="email" defaultValue={l.email ?? ""} className="input" /></F>
            <F label="電話(代表)"><input name="phone" defaultValue={l.phone ?? ""} className="input" /></F>
            <F label="携帯電話"><input name="mobile_phone" defaultValue={l.mobile_phone ?? ""} className="input" /></F>
            <F label="部署"><input name="department" defaultValue={l.department ?? ""} className="input" /></F>
            <F label="役職(テキスト)"><input name="job_title" defaultValue={l.job_title ?? ""} className="input" /></F>
            <F label="業種"><input name="industry" defaultValue={l.industry ?? ""} className="input" /></F>
            <F label="都道府県"><input name="prefecture" defaultValue={l.prefecture ?? ""} className="input" /></F>
          </div>
        </Section>

        <Section title="優先度の項目（規模×役職×ニーズ×時期×権限×予算）" action={<span className="text-xs text-ink/40">保存でスコア再計算</span>}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <F label="従業員規模"><input name="employee_size" defaultValue={l.employee_size ?? ""} className="input" placeholder="例：1,000名以上" /></F>
            <Sel label="売上規模" name="revenue_size" value={l.revenue_size} opts={REVENUE_OPTS} />
            <Sel label="役職区分" name="role_level" value={l.role_level} opts={ROLE_LEVELS} />
            <Sel label="ニーズ" name="needs" value={l.needs} opts={NEEDS_OPTS} />
            <Sel label="タイミング" name="timing" value={l.timing} opts={TIMING_OPTS} />
            <Sel label="権限" name="authority" value={l.authority} opts={AUTHORITY_OPTS} />
            <Sel label="予算" name="budget_band" value={l.budget_band} opts={BUDGET_OPTS} />
            <F label="予算額(円)"><input name="budget_amount" type="number" defaultValue={l.budget_amount ?? ""} className="input" /></F>
          </div>
          <p className="text-[11px] text-ink/40 mt-2">※ リードから取得できない項目は空でOK。分かった時点で入力すると優先度が更新されます。</p>
        </Section>

        <Section title="架電・決着">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <F label="ランク"><input name="rank" defaultValue={l.rank ?? ""} className="input" /></F>
            <Sel label="決着" name="disposition" value={l.disposition} opts={LEAD_DISPOSITIONS} />
            <F label="架電担当"><input name="call_owner" defaultValue={l.call_owner ?? ""} className="input" /></F>
          </div>
          <F label="メモ"><textarea name="notes" rows={2} defaultValue={l.notes ?? ""} className="input" /></F>
        </Section>

        <button type="submit" className="btn-primary">保存する</button>
      </form>

      {/* 削除(控えめ・確認つき) */}
      <Card className="mt-8 border-l-4 border-l-rose-300">
        <details>
          <summary className="cursor-pointer text-sm text-ink/50">危険な操作（このリードを削除）</summary>
          <form action={deleteLeadAction} className="mt-3 flex items-center gap-3">
            <input type="hidden" name="id" value={l.id} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 px-3 py-1.5 text-sm hover:bg-rose-100">
              <Trash2 size={15} /> このリードを削除する
            </button>
            <span className="text-xs text-ink/40">削除は元に戻せません。取込のやり直しは「取込履歴」からの一括取り消しが安全です。</span>
          </form>
        </details>
      </Card>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
function Sel({ label, name, value, opts }: { label: string; name: string; value?: string; opts: { key: string; label: string }[] }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select name={name} defaultValue={value ?? ""} className="input">
        <option value="">—</option>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
  );
}
