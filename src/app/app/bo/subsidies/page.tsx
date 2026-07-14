import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createSubsidyCaseAction, updateSubsidyCaseAction, addSubsidyMilestoneAction } from "@/server/actions/bo";
import { SubmitButton } from "@/components/ui/submit-button";
import { MilestoneRow } from "@/components/bo/milestone-row";

export const dynamic = "force-dynamic";

interface Milestone { id: string; kind: string; label: string; due_date: string; status: string; completed_at: string | null; }
interface CaseRow {
  id: string; account_name: string; training_name: string; training_start_date: string;
  training_end_date: string | null; program_name: string; status: string;
  subsidy_milestones: Milestone[];
}
interface TrainingDeal { id: string; account_name: string | null; name: string; won_date: string | null; }

/** BO-1 助成金トラッカー: 3つの納期(説明会/事前申請/実績報告)を絶対に落とさない。 */
export default async function SubsidiesPage() {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const [casesR, dealsR] = await Promise.all([
    sb
      .from("subsidy_cases")
      .select("id, account_name, training_name, training_start_date, training_end_date, program_name, status, subsidy_milestones(id, kind, label, due_date, status, completed_at)")
      .order("training_start_date", { ascending: false })
      .limit(200),
    sb.rpc("bo_training_deals"),
  ]);
  const cases = (casesR.data ?? []) as unknown as CaseRow[];
  const deals = ((dealsR.data ?? []) as TrainingDeal[]).slice(0, 100);
  const openCases = cases.filter((c) => c.status === "open");
  const allMs = openCases.flatMap((c) => c.subsidy_milestones.filter((m) => m.status === "todo"));
  const overdue = allMs.filter((m) => m.due_date < today);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="助成金トラッカー"
        subtitle="研修の助成金対応(事前説明会・事前申請=研修1ヶ月前・実績報告=研修後2ヶ月)を期日で管理します。"
      />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">対応中の案件</div><div className="stat-value mt-1">{openCases.length}</div></Card>
        <Card><div className="text-xs text-ink/50">未完了の納期</div><div className="stat-value mt-1">{allMs.length}</div></Card>
        <Card><div className="text-xs text-ink/50">期限超過</div><div className={`stat-value mt-1 ${overdue.length ? "text-rose-600" : ""}`}>{overdue.length}</div></Card>
      </div>

      <Section title="助成金案件を登録" className="mb-5">
        <form action={createSubsidyCaseAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">受注済みの研修案件から選ぶ（任意）</label>
              <select name="opportunity_id" className="input" defaultValue="">
                <option value="">選択しない（手入力）</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>{d.account_name ?? "—"}｜{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">会社名 *</label>
              <input name="account_name" required className="input" placeholder="例: 株式会社○○" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">研修名 *</label>
              <input name="training_name" required className="input" placeholder="例: 生成AI活用研修" />
            </div>
            <div>
              <label className="label">研修開始日 *</label>
              <input name="training_start_date" type="date" required className="input" />
            </div>
            <div>
              <label className="label">研修終了日</label>
              <input name="training_end_date" type="date" className="input" />
            </div>
          </div>
          <SubmitButton className="btn-accent" pendingLabel="保存中…">登録（納期3件を自動生成）</SubmitButton>
          <p className="text-[11px] text-ink/35">事前説明会=開始6週間前 / 事前申請=開始1ヶ月前 / 実績報告=終了2ヶ月後 で自動設定されます。</p>
        </form>
      </Section>

      <div className="space-y-4">
        {cases.map((c) => {
          const done = c.subsidy_milestones.filter((m) => m.status === "done").length;
          return (
            <div key={c.id} className={`card card-pad ${c.status !== "open" ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-semibold text-ink">{c.account_name}｜{c.training_name}</span>
                <span className="text-xs text-ink/45">{c.training_start_date} 〜 {c.training_end_date ?? ""}</span>
                <span className="pill bg-black/[0.05] text-ink/50">{c.program_name}</span>
                <span className="text-xs text-ink/40 ml-auto">{done}/{c.subsidy_milestones.length} 完了</span>
                <form action={updateSubsidyCaseAction} className="inline-flex gap-1.5">
                  <input type="hidden" name="id" value={c.id} />
                  {c.status === "open" ? (
                    <button name="op" value="done" className="text-xs text-teal-deep hover:underline">完了にする</button>
                  ) : (
                    <button name="op" value="open" className="text-xs text-ink/45 hover:underline">再開</button>
                  )}
                  <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                </form>
              </div>
              <ul className="space-y-1.5">
                {c.subsidy_milestones
                  .slice()
                  .sort((a, b) => a.due_date.localeCompare(b.due_date))
                  .map((m) => (
                    <MilestoneRow key={m.id} m={m} today={today} />
                  ))}
              </ul>

              {/* やる事を追加(定型3件のほかに業務を登録) */}
              <form action={addSubsidyMilestoneAction} className="mt-2.5 flex items-end gap-2 flex-wrap border-t border-black/[0.05] pt-2.5">
                <input type="hidden" name="case_id" value={c.id} />
                <div>
                  <label className="label text-[11px]">やる事を追加</label>
                  <input name="label" required maxLength={120} placeholder="例: 交付申請書の提出" className="input py-1 text-sm w-64" />
                </div>
                <div>
                  <label className="label text-[11px]">期日</label>
                  <input name="due_date" type="date" required className="input py-1 text-sm" />
                </div>
                <SubmitButton className="btn-ghost text-xs" pendingLabel="追加中…">＋ 追加</SubmitButton>
              </form>
            </div>
          );
        })}
        {cases.length === 0 && <p className="text-sm text-ink/40 py-8 text-center">助成金案件はまだありません。上のフォームから登録してください。</p>}
      </div>
    </div>
  );
}
