import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createFuCaseAction, updateFuCaseAction, updateFuMeetingAction } from "@/server/actions/bo";

export const dynamic = "force-dynamic";

const SCHED = [
  { key: "not_scheduled", label: "未調整" },
  { key: "scheduled", label: "調整済" },
  { key: "done", label: "実施済" },
  { key: "skipped", label: "見送り" },
];
const UPSELL = [
  { key: "none", label: "なし" },
  { key: "proposed", label: "提案中" },
  { key: "won", label: "受注" },
];

interface FuCase {
  id: string; account_name: string; training_name: string | null; won_date: string; status: string; notes: string | null;
}
interface FuMtg {
  id: string; case_id: string; round_months: number; due_date: string; schedule_status: string;
  held_on: string | null; ai_score: number | null; issues: string | null; proposal_done: boolean;
  upsell_status: string; notes: string | null;
}

/** BO-6 研修後フォローアップ: 受注研修を母数に1/3/6ヶ月後Mtgと活用度・アップセルを追跡。 */
export default async function FollowupsPage() {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date().toISOString().slice(0, 10);
  const [casesR, mtgR] = await Promise.all([
    sb.from("fu_cases").select("id, account_name, training_name, won_date, status, notes").order("won_date", { ascending: false }).limit(300),
    sb.from("fu_meetings").select("id, case_id, round_months, due_date, schedule_status, held_on, ai_score, issues, proposal_done, upsell_status, notes").order("round_months").limit(1000),
  ]);
  const cases = (casesR.data ?? []) as FuCase[];
  const mtgs = (mtgR.data ?? []) as FuMtg[];
  const byCase = new Map<string, FuMtg[]>();
  for (const m of mtgs) (byCase.get(m.case_id) ?? byCase.set(m.case_id, []).get(m.case_id)!).push(m);

  const open = cases.filter((c) => c.status === "open");
  const openIds = new Set(open.map((c) => c.id));
  const activeMtgs = mtgs.filter((m) => openIds.has(m.case_id) && m.schedule_status !== "skipped");
  const doneMtgs = activeMtgs.filter((m) => m.schedule_status === "done");
  const overdue = activeMtgs.filter((m) => m.schedule_status !== "done" && m.due_date < today);
  const upsellWon = mtgs.filter((m) => m.upsell_status === "won").length;
  const upsellProposed = mtgs.filter((m) => m.upsell_status === "proposed").length;

  return (
    <div className="max-w-5xl">
      <PageHeader title="研修後フォローアップ" subtitle="受注した研修案件を母数に、1・3・6ヶ月後のフォローMtgの日程調整・実施と、AI活用度の進化・業務課題・提案・アップセルを追跡します。受注が発生すると自動で追加されます。" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">対象(進行中)</div><div className="stat-value mt-1">{open.length}<span className="stat-unit">社</span></div></Card>
        <Card><div className="text-xs text-ink/50">実施済みMtg</div><div className="stat-value mt-1">{doneMtgs.length}<span className="stat-unit">/{activeMtgs.length}</span></div></Card>
        <Card><div className="text-xs text-ink/50">期日超過(未実施)</div><div className={`stat-value mt-1 ${overdue.length ? "text-rose-600" : ""}`}>{overdue.length}</div></Card>
        <Card><div className="text-xs text-ink/50">アップセル提案中</div><div className="stat-value mt-1">{upsellProposed}</div></Card>
        <Card><div className="text-xs text-ink/50">アップセル受注</div><div className={`stat-value mt-1 ${upsellWon ? "text-teal-deep" : ""}`}>{upsellWon}</div></Card>
      </div>

      <Section title="対象を手動追加（受注案件は自動で追加されます）" className="mb-5">
        <form action={createFuCaseAction} className="flex items-end gap-2.5 flex-wrap">
          <div><label className="label">会社名 *</label><input name="account_name" required className="input" /></div>
          <div><label className="label">研修名</label><input name="training_name" className="input" /></div>
          <div><label className="label">基準日(受注日)</label><input name="won_date" type="date" className="input w-auto" /></div>
          <button type="submit" className="btn-accent">追加（1/3/6ヶ月後Mtgを自動生成）</button>
        </form>
      </Section>

      <Section title={`フォローアップ一覧（${cases.length}）`}>
        {cases.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">対象がまだありません</p>
        ) : (
          <ul className="space-y-3">
            {cases.map((c) => {
              const rows = byCase.get(c.id) ?? [];
              const scores = rows.filter((m) => m.ai_score != null).map((m) => `${m.round_months}ヶ月:${m.ai_score}点`);
              return (
                <li key={c.id} className={`rounded-xl border border-black/[0.05] p-3 ${c.status !== "open" ? "opacity-55" : ""}`}>
                  <div className="flex items-center gap-2.5 flex-wrap text-sm mb-2">
                    <span className="font-medium text-ink">{c.account_name}</span>
                    {c.training_name && <span className="text-xs text-ink/45">{c.training_name}</span>}
                    <span className="text-xs text-ink/40 tabular-nums">受注 {c.won_date}</span>
                    {scores.length > 0 && <span className="pill bg-teal-light text-teal-deep text-xs">AI活用度 {scores.join(" → ")}</span>}
                    <form action={updateFuCaseAction} className="ml-auto flex items-center gap-1.5">
                      <input type="hidden" name="id" value={c.id} />
                      {c.status === "open" ? (
                        <>
                          <button name="op" value="done" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]">完了</button>
                          <button name="op" value="skipped" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]">対象外</button>
                        </>
                      ) : (
                        <button name="op" value="open" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]">再開</button>
                      )}
                      <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                    </form>
                  </div>

                  <div className="space-y-2">
                    {rows.map((m) => {
                      const late = m.schedule_status !== "done" && m.schedule_status !== "skipped" && m.due_date < today && c.status === "open";
                      return (
                        <form key={m.id} action={updateFuMeetingAction} className={`rounded-lg border p-2 ${late ? "border-rose-200 bg-rose-50/40" : "border-black/[0.04]"}`}>
                          <input type="hidden" name="id" value={m.id} />
                          <div className="flex items-end gap-2 flex-wrap">
                            <span className={`pill shrink-0 text-xs ${m.schedule_status === "done" ? "bg-teal-light text-teal-deep" : late ? "bg-rose-50 text-rose-600" : "bg-black/[0.05] text-ink/60"}`}>
                              {m.round_months}ヶ月後{late && " 超過"}
                            </span>
                            <div><label className="label">期日</label><input name="due_date" type="date" defaultValue={m.due_date} className="input w-auto text-xs py-1" /></div>
                            <div>
                              <label className="label">日程調整</label>
                              <select name="schedule_status" defaultValue={m.schedule_status} className="input w-auto text-xs py-1">
                                {SCHED.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                              </select>
                            </div>
                            <div><label className="label">実施日</label><input name="held_on" type="date" defaultValue={m.held_on ?? ""} className="input w-auto text-xs py-1" /></div>
                            <div><label className="label">AI活用度(点)</label><input name="ai_score" type="number" min={0} max={100} defaultValue={m.ai_score ?? ""} className="input w-20 text-xs py-1" /></div>
                            <label className="flex items-center gap-1.5 text-xs text-ink/70 pb-1.5">
                              <input type="checkbox" name="proposal_done" defaultChecked={m.proposal_done} className="accent-teal-600" />
                              ソリューション提案済
                            </label>
                            <div>
                              <label className="label">アップセル</label>
                              <select name="upsell_status" defaultValue={m.upsell_status} className="input w-auto text-xs py-1">
                                {UPSELL.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                              </select>
                            </div>
                            <button type="submit" className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs hover:bg-black/[0.03]">保存</button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-1.5">
                            <input name="issues" defaultValue={m.issues ?? ""} className="input flex-1 min-w-[220px] text-xs py-1" placeholder="他の業務課題（ここからソリューション提案につなげる）" />
                            <input name="notes" defaultValue={m.notes ?? ""} className="input flex-1 min-w-[160px] text-xs py-1" placeholder="メモ" />
                          </div>
                        </form>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
