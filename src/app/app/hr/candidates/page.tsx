import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createCandidateAction, updateCandidateAction, addInterviewAction } from "@/server/actions/hr";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

const STATUSES = [
  { key: "applied", label: "応募" },
  { key: "screening", label: "書類選考" },
  { key: "first", label: "一次面接" },
  { key: "second", label: "二次面接" },
  { key: "final", label: "最終面接" },
  { key: "offer", label: "内定" },
  { key: "joined", label: "入社・稼働" },
  { key: "rejected", label: "見送り" },
  { key: "declined", label: "辞退" },
];
const STEP_LABEL: Record<string, string> = { screening: "書類", first: "一次", second: "二次", final: "最終" };
const RESULT_LABEL: Record<string, string> = { pass: "通過", fail: "不合格", hold: "保留" };
const CLOSED = new Set(["joined", "rejected", "declined"]);

interface Candidate {
  id: string; job_opening_id: string | null; name: string; email: string | null;
  source: string | null; status: string; notes: string | null; created_at: string;
}
interface Interview {
  id: string; candidate_id: string; step: string; scheduled_at: string | null;
  interviewer: string | null; result: string | null; score: number | null; notes: string | null;
}
interface Opening { id: string; title: string; client_name: string | null; kind: string; status: string; }

function fmtDt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** BO-5 候補者パイプライン: 応募→書類→一次→二次→最終→内定→入社。面接記録つき。 */
export default async function CandidatesPage() {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const [candR, ivR, openR] = await Promise.all([
    sb.from("candidates").select("id, job_opening_id, name, email, source, status, notes, created_at").order("created_at", { ascending: false }).limit(300),
    sb.from("interviews").select("id, candidate_id, step, scheduled_at, interviewer, result, score, notes").order("created_at", { ascending: true }).limit(1000),
    sb.from("job_openings").select("id, title, client_name, kind, status").order("created_at", { ascending: false }).limit(200),
  ]);
  const candidates = (candR.data ?? []) as Candidate[];
  const interviews = (ivR.data ?? []) as Interview[];
  const openings = (openR.data ?? []) as Opening[];
  const openingOf = new Map(openings.map((o) => [o.id, o]));
  const ivByCand = new Map<string, Interview[]>();
  for (const iv of interviews) {
    (ivByCand.get(iv.candidate_id) ?? ivByCand.set(iv.candidate_id, []).get(iv.candidate_id)!).push(iv);
  }
  const inflight = candidates.filter((c) => !CLOSED.has(c.status));
  const joined = candidates.filter((c) => c.status === "joined");

  return (
    <div className="max-w-4xl">
      <PageHeader title="候補者" subtitle="採用〜面接のパイプライン。入社にすると自動でタレント台帳に登録されます。" />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">選考中</div><div className="stat-value mt-1">{inflight.length}</div></Card>
        <Card><div className="text-xs text-ink/50">入社・稼働</div><div className="stat-value mt-1 text-teal-deep">{joined.length}</div></Card>
        <Card><div className="text-xs text-ink/50">面接記録</div><div className="stat-value mt-1">{interviews.length}</div></Card>
      </div>

      <Section title="候補者を追加" className="mb-5">
        <form action={createCandidateAction} className="flex items-end gap-2.5 flex-wrap">
          <div><label className="label">氏名 *</label><input name="name" required className="input" /></div>
          <div className="min-w-[220px]">
            <label className="label">求人案件</label>
            <select name="job_opening_id" className="input" defaultValue="">
              <option value="">未紐付け</option>
              {openings.filter((o) => o.status === "open" || o.status === "interviewing").map((o) => (
                <option key={o.id} value={o.id}>{o.title}{o.client_name ? `（${o.client_name}）` : ""}</option>
              ))}
            </select>
          </div>
          <div><label className="label">メール</label><input name="email" type="email" className="input" /></div>
          <div><label className="label">経路</label><input name="source" className="input" placeholder="紹介/媒体名など" /></div>
          <SubmitButton className="btn-accent" pendingLabel="追加中…">追加</SubmitButton>
        </form>
      </Section>

      <Section title={`候補者一覧（${candidates.length}）`}>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">候補者がまだいません</p>
        ) : (
          <ul className="space-y-3">
            {candidates.map((c) => {
              const ivs = ivByCand.get(c.id) ?? [];
              const opening = c.job_opening_id ? openingOf.get(c.job_opening_id) : null;
              return (
                <li key={c.id} className="rounded-xl border border-black/[0.05] p-3">
                  <form action={updateCandidateAction} className="space-y-2">
                    <input type="hidden" name="id" value={c.id} />
                    <div className="flex items-center gap-2.5 flex-wrap text-sm">
                      <span className="font-medium">{c.name}</span>
                      {opening && <span className="pill bg-teal-light text-teal-deep text-xs">{opening.title}</span>}
                      {c.source && <span className="text-xs text-ink/45">{c.source}</span>}
                      {c.email && <span className="text-xs text-ink/40">{c.email}</span>}
                      <select name="status" defaultValue={c.status} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs ml-auto">
                        {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      <SubmitButton className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]" pendingLabel="保存中…">保存</SubmitButton>
                      <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                    </div>
                    <input name="notes" defaultValue={c.notes ?? ""} className="input text-xs py-1.5" placeholder="メモ" />
                  </form>

                  {ivs.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-ink/60">
                      {ivs.map((iv) => (
                        <li key={iv.id} className="flex items-center gap-2 flex-wrap">
                          <span className="pill bg-black/[0.04] text-ink/60">{STEP_LABEL[iv.step] ?? iv.step}</span>
                          {iv.scheduled_at && <span className="tabular-nums">{fmtDt(iv.scheduled_at)}</span>}
                          {iv.interviewer && <span>面接官: {iv.interviewer}</span>}
                          {iv.result && <span className={iv.result === "pass" ? "text-teal-deep font-medium" : iv.result === "fail" ? "text-rose-600" : ""}>{RESULT_LABEL[iv.result] ?? iv.result}</span>}
                          {iv.score != null && <span className="tabular-nums">評点 {iv.score}</span>}
                          {iv.notes && <span className="text-ink/45">{iv.notes}</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-teal-deep">＋ 面接を記録</summary>
                    <form action={addInterviewAction} className="mt-2 flex items-end gap-2 flex-wrap">
                      <input type="hidden" name="candidate_id" value={c.id} />
                      <div>
                        <label className="label">選考</label>
                        <select name="step" className="input w-auto text-xs" defaultValue="first">
                          <option value="screening">書類</option>
                          <option value="first">一次</option>
                          <option value="second">二次</option>
                          <option value="final">最終</option>
                        </select>
                      </div>
                      <div><label className="label">日時</label><input name="scheduled_at" type="datetime-local" className="input w-auto text-xs" /></div>
                      <div><label className="label">面接官</label><input name="interviewer" className="input w-28 text-xs" /></div>
                      <div>
                        <label className="label">結果</label>
                        <select name="result" className="input w-auto text-xs" defaultValue="">
                          <option value="">未実施</option>
                          <option value="pass">通過</option>
                          <option value="fail">不合格</option>
                          <option value="hold">保留</option>
                        </select>
                      </div>
                      <div><label className="label">評点1-5</label><input name="score" type="number" min={1} max={5} className="input w-16 text-xs" /></div>
                      <div className="min-w-[160px] flex-1"><label className="label">メモ</label><input name="notes" className="input text-xs" /></div>
                      <SubmitButton className="rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/[0.03]" pendingLabel="記録中…">記録</SubmitButton>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
