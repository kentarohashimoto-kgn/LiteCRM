import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createCaseStudyAction, updateCaseStudyAction } from "@/server/actions/bo";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

const STATUSES = [
  { key: "not_approached", label: "未打診" },
  { key: "approaching", label: "打診中" },
  { key: "agreed", label: "承諾" },
  { key: "interviewed", label: "取材済" },
  { key: "writing", label: "記事作成中" },
  { key: "published", label: "公開" },
  { key: "declined", label: "辞退・対象外" },
];

interface CaseRow {
  id: string; account_name: string; training_name: string | null; status: string;
  published_url: string | null; next_action_date: string | null; notes: string | null;
}
interface TrainingDeal { id: string; account_name: string | null; name: string; }

/** BO-2 事例・インタビュー管理: 研修受講会社の事例化率を数字で回す。 */
export default async function CasesPage() {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const [casesR, dealsR] = await Promise.all([
    sb.from("case_studies").select("id, account_name, training_name, status, published_url, next_action_date, notes").order("created_at", { ascending: false }).limit(300),
    sb.rpc("bo_training_deals"),
  ]);
  const cases = (casesR.data ?? []) as CaseRow[];
  const deals = ((dealsR.data ?? []) as TrainingDeal[]).slice(0, 100);
  const active = cases.filter((c) => c.status !== "declined");
  const published = cases.filter((c) => c.status === "published");
  const rate = active.length ? Math.round((published.length / active.length) * 100) : 0;

  return (
    <div className="max-w-4xl">
      <PageHeader title="事例・インタビュー管理" subtitle="研修受講会社への事例化を「未打診→打診→承諾→取材→記事化→公開」で管理します。" />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">対象(辞退除く)</div><div className="stat-value mt-1">{active.length}</div></Card>
        <Card><div className="text-xs text-ink/50">公開済み</div><div className="stat-value mt-1 text-teal-deep">{published.length}</div></Card>
        <Card><div className="text-xs text-ink/50">事例化率</div><div className="stat-value mt-1">{rate}<span className="stat-unit">%</span></div></Card>
      </div>

      <Section title="対象を追加" className="mb-5">
        <form action={createCaseStudyAction} className="flex items-end gap-2.5 flex-wrap">
          <div className="min-w-[220px]">
            <label className="label">受注済みの研修案件から（任意）</label>
            <select name="opportunity_id" className="input" defaultValue="">
              <option value="">選択しない</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.account_name ?? "—"}｜{d.name}</option>)}
            </select>
          </div>
          <div><label className="label">会社名 *</label><input name="account_name" required className="input" /></div>
          <div><label className="label">研修名</label><input name="training_name" className="input" /></div>
          <SubmitButton className="btn-accent" pendingLabel="追加中…">追加</SubmitButton>
        </form>
      </Section>

      <Section title={`事例パイプライン（${cases.length}）`}>
        {cases.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">対象がまだありません</p>
        ) : (
          <ul className="space-y-3">
            {cases.map((c) => (
              <li key={c.id} className="rounded-xl border border-black/[0.05] p-3">
                <form action={updateCaseStudyAction} className="space-y-2">
                  <input type="hidden" name="id" value={c.id} />
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-medium text-ink">{c.account_name}</span>
                    {c.training_name && <span className="text-xs text-ink/45">{c.training_name}</span>}
                    <select name="status" defaultValue={c.status} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs ml-auto">
                      {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <input name="next_action_date" type="date" defaultValue={c.next_action_date ?? ""} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs" title="次アクション日" />
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <input name="published_url" defaultValue={c.published_url ?? ""} className="input flex-1 min-w-[200px] text-xs py-1.5" placeholder="公開URL" />
                    <input name="notes" defaultValue={c.notes ?? ""} className="input flex-1 min-w-[200px] text-xs py-1.5" placeholder="メモ" />
                    <SubmitButton className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs hover:bg-black/[0.03]" pendingLabel="保存中…">保存</SubmitButton>
                    <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
