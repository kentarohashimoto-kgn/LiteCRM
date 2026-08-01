import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2, X } from "lucide-react";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { AttachmentSection } from "@/components/attachments/attachment-section";
import { DocumentSection } from "@/components/documents/document-section";
import {
  saveCandidateAction,
  updateCandidateStatusAction,
  deleteCandidateAction,
  linkCandidateOpeningAction,
  unlinkCandidateOpeningAction,
  addInterviewAction,
  deleteInterviewAction,
} from "@/server/actions/hr";
import {
  CANDIDATE_STATUSES,
  INTERVIEW_STEPS,
  INTERVIEW_STEP_LABEL,
  INTERVIEW_RESULTS,
  INTERVIEW_RESULT_LABEL,
} from "@/lib/hr-constants";

export const dynamic = "force-dynamic";

interface Candidate {
  id: string; name: string; furigana: string | null; email: string | null; phone: string | null;
  area: string | null; source: string | null; status: string; notes: string | null; age: number | null;
  desired_conditions: string | null; desired_contract: string | null; available_from: string | null;
  desired_workload: string | null; desired_pay: string | null; work_location_pref: string | null; skills: string | null;
}
interface Interview {
  id: string; step: string; scheduled_at: string | null; interviewer: string | null;
  result: string | null; score: number | null; notes: string | null;
  good_points: string | null; concerns: string | null; next_action: string | null; next_action_due: string | null;
}
interface OpeningLink { id: string; job_opening_id: string; role_note: string | null; job_openings: { title: string; client_name: string | null } | { title: string; client_name: string | null }[] | null; }
interface Opening { id: string; title: string; client_name: string | null; status: string; }

function fmtDt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="label">{label}</label>{children}</div>);
}

/** 候補者 詳細ページ。基本情報の編集・複数求人の紐付け・書類添付・選考履歴・削除。 */
export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { saved?: string; error?: string };
}) {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const { data: cand } = await sb
    .from("candidates")
    .select("id, name, furigana, email, phone, area, source, status, notes, age, desired_conditions, desired_contract, available_from, desired_workload, desired_pay, work_location_pref, skills")
    .eq("id", params.id)
    .maybeSingle();
  if (!cand) notFound();
  const c = cand as Candidate;

  const [ivR, linkR, openR] = await Promise.all([
    sb.from("interviews").select("id, step, scheduled_at, interviewer, result, score, notes, good_points, concerns, next_action, next_action_due").eq("candidate_id", c.id).order("created_at", { ascending: true }),
    sb.from("candidate_openings").select("id, job_opening_id, role_note, job_openings(title, client_name)").eq("candidate_id", c.id),
    sb.from("job_openings").select("id, title, client_name, status").order("created_at", { ascending: false }).limit(200),
  ]);
  const interviews = (ivR.data ?? []) as Interview[];
  const links = (linkR.data ?? []) as OpeningLink[];
  const openings = (openR.data ?? []) as Opening[];
  const linkedIds = new Set(links.map((l) => l.job_opening_id));
  const v = (s: string | null) => s ?? "";

  return (
    <div className="max-w-4xl">
      <Link href="/app/hr/candidates" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 候補者一覧
      </Link>

      <PageHeader
        title={c.name}
        subtitle={c.furigana ?? undefined}
        action={
          <form action={updateCandidateStatusAction} className="flex items-center gap-1.5">
            <input type="hidden" name="id" value={c.id} />
            <select name="status" defaultValue={c.status} className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm">
              {CANDIDATE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <SubmitButton className="btn-ghost text-sm" pendingLabel="…">変更</SubmitButton>
          </form>
        }
      />

      {searchParams.saved && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">保存しました。</div>
      )}
      {searchParams.error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">氏名は必須です。保存できませんでした。</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* 基本情報 */}
          <Section title="基本情報">
            <form action={saveCandidateAction} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="氏名 *"><input name="name" required defaultValue={c.name} className="input" /></Field>
                <Field label="フリガナ"><input name="furigana" defaultValue={v(c.furigana)} className="input" /></Field>
                <Field label="年齢"><input name="age" type="number" min={0} max={99} inputMode="numeric" defaultValue={c.age != null ? String(c.age) : ""} className="input" /></Field>
                <Field label="メール"><input name="email" type="email" defaultValue={v(c.email)} className="input" /></Field>
                <Field label="電話番号"><input name="phone" defaultValue={v(c.phone)} className="input" /></Field>
                <Field label="居住地域"><input name="area" defaultValue={v(c.area)} className="input" /></Field>
                <Field label="経路"><input name="source" defaultValue={v(c.source)} className="input" placeholder="紹介/媒体名など" /></Field>
                <Field label="希望契約形態"><input name="desired_contract" defaultValue={v(c.desired_contract)} className="input" /></Field>
                <Field label="稼働可能時期"><input name="available_from" defaultValue={v(c.available_from)} className="input" /></Field>
                <Field label="希望稼働量"><input name="desired_workload" defaultValue={v(c.desired_workload)} className="input" /></Field>
                <Field label="希望単価・報酬"><input name="desired_pay" defaultValue={v(c.desired_pay)} className="input" /></Field>
                <Field label="出社・リモート条件"><input name="work_location_pref" defaultValue={v(c.work_location_pref)} className="input" /></Field>
              </div>
              <Field label="希望・稼働条件"><textarea name="desired_conditions" defaultValue={v(c.desired_conditions)} rows={2} className="input resize-y" /></Field>
              <Field label="スキル情報"><textarea name="skills" defaultValue={v(c.skills)} rows={3} className="input resize-y" placeholder="保有スキル・経験・得意領域など（改行可）" /></Field>
              <Field label="人事コメント"><textarea name="notes" defaultValue={v(c.notes)} rows={2} className="input resize-y" placeholder="選考所感・申し送りなど（一覧にも表示されます）" /></Field>
              <SubmitButton className="btn-accent" pendingLabel="保存中…">基本情報を保存</SubmitButton>
            </form>
          </Section>

          {/* 選考履歴 */}
          <Section title={`選考履歴（${interviews.length}）`}>
            {interviews.length === 0 ? (
              <p className="text-sm text-ink/40 py-2">選考履歴はまだありません。</p>
            ) : (
              <ul className="space-y-2">
                {interviews.map((iv) => (
                  <li key={iv.id} className="rounded-xl border border-black/[0.05] p-3 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="pill bg-black/[0.04] text-ink/60">{INTERVIEW_STEP_LABEL[iv.step] ?? iv.step}</span>
                      {iv.scheduled_at && <span className="text-xs text-ink/50 tabular-nums">{fmtDt(iv.scheduled_at)}</span>}
                      {iv.interviewer && <span className="text-xs text-ink/50">面接官: {iv.interviewer}</span>}
                      {iv.result && <span className={`pill text-[10px] ${iv.result === "pass" ? "bg-teal-light text-teal-deep" : iv.result === "fail" ? "bg-rose-100 text-rose-600" : iv.result === "declined" ? "bg-amber-50 text-amber-700" : "bg-black/[0.04] text-ink/55"}`}>{INTERVIEW_RESULT_LABEL[iv.result] ?? iv.result}</span>}
                      {iv.score != null && <span className="text-xs text-amber-600">評点 {iv.score}/5</span>}
                      <form action={deleteInterviewAction} className="ml-auto">
                        <input type="hidden" name="id" value={iv.id} />
                        <input type="hidden" name="candidate_id" value={c.id} />
                        <button className="text-ink/30 hover:text-rose-500" title="この選考記録を削除"><X size={14} /></button>
                      </form>
                    </div>
                    {(iv.good_points || iv.concerns || iv.next_action || iv.next_action_due || iv.notes) && (
                      <div className="mt-2 space-y-1 text-xs text-ink/70">
                        {iv.good_points && <p><span className="text-emerald-600 font-medium">良かった点:</span> {iv.good_points}</p>}
                        {iv.concerns && <p><span className="text-rose-500 font-medium">懸念点:</span> {iv.concerns}</p>}
                        {iv.next_action && <p><span className="text-teal-deep font-medium">次回アクション:</span> {iv.next_action}{iv.next_action_due ? `（期限 ${iv.next_action_due}）` : ""}</p>}
                        {!iv.next_action && iv.next_action_due && <p><span className="text-teal-deep font-medium">次回対応期限:</span> {iv.next_action_due}</p>}
                        {iv.notes && <p className="text-ink/55">{iv.notes}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 選考記録を追加</summary>
              <form action={addInterviewAction} className="mt-3 space-y-3 border-t border-black/[0.05] pt-3">
                <input type="hidden" name="candidate_id" value={c.id} />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <Field label="選考">
                    <select name="step" className="input" defaultValue="first">
                      {INTERVIEW_STEPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </Field>
                  <Field label="日時"><input name="scheduled_at" type="datetime-local" className="input" /></Field>
                  <Field label="面接官"><input name="interviewer" className="input" /></Field>
                  <Field label="結果">
                    <select name="result" className="input" defaultValue="">
                      <option value="">未実施</option>
                      {INTERVIEW_RESULTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <Field label="良かった点"><textarea name="good_points" rows={2} className="input resize-y" /></Field>
                  <Field label="懸念点"><textarea name="concerns" rows={2} className="input resize-y" /></Field>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <div className="col-span-2 md:col-span-2"><Field label="次回アクション"><input name="next_action" className="input" /></Field></div>
                  <Field label="次回対応期限"><input name="next_action_due" type="date" className="input" /></Field>
                  <Field label="評点1-5"><input name="score" type="number" min={1} max={5} className="input" /></Field>
                </div>
                <Field label="メモ"><input name="notes" className="input" /></Field>
                <SubmitButton className="btn-accent" pendingLabel="記録中…">選考記録を追加</SubmitButton>
              </form>
            </details>
          </Section>
        </div>

        {/* 右カラム: 紐付け求人・書類・削除 */}
        <div className="space-y-5">
          {/* 紐付け求人(複数可) */}
          <Section title={`紐付け求人（${links.length}）`}>
            {links.length === 0 ? (
              <p className="text-sm text-ink/40 py-1">紐付いた求人はありません。</p>
            ) : (
              <ul className="space-y-1.5">
                {links.map((l) => {
                  const jo = one(l.job_openings);
                  return (
                    <li key={l.id} className="flex items-center gap-1.5 text-sm">
                      <Link href={`/app/hr/openings/${l.job_opening_id}`} className="text-teal-deep hover:underline flex-1 truncate">
                        {jo?.title ?? "求人"}{jo?.client_name ? `（${jo.client_name}）` : ""}{l.role_note ? ` ・ ${l.role_note}` : ""}
                      </Link>
                      <form action={unlinkCandidateOpeningAction}>
                        <input type="hidden" name="candidate_id" value={c.id} />
                        <input type="hidden" name="link_id" value={l.id} />
                        <button className="text-ink/30 hover:text-rose-500" title="紐付けを解除"><X size={14} /></button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            <form action={linkCandidateOpeningAction} className="mt-3 space-y-2 border-t border-black/[0.05] pt-3">
              <input type="hidden" name="candidate_id" value={c.id} />
              <select name="job_opening_id" required className="input" defaultValue="">
                <option value="" disabled>求人を選択</option>
                {openings.filter((o) => !linkedIds.has(o.id)).map((o) => (
                  <option key={o.id} value={o.id}>{o.title}{o.client_name ? `（${o.client_name}）` : ""}{o.status === "closed" ? "（クローズ）" : ""}</option>
                ))}
              </select>
              <input name="role_note" className="input text-sm" placeholder="役割メモ（任意・例: 講師/営業）" />
              <SubmitButton className="btn-ghost text-sm w-full" pendingLabel="追加中…">求人を紐付ける</SubmitButton>
            </form>
          </Section>

          {/* 書類添付(履歴書・職務経歴書・スキルシート) */}
          <DocumentSection targetType="candidate" targetId={c.id} revalidatePath={`/app/hr/candidates/${c.id}`} />
          <AttachmentSection targetType="candidate" targetId={c.id} revalidatePath={`/app/hr/candidates/${c.id}`} emptyHint="履歴書・職務経歴書・スキルシートなどを添付できます" />

          {/* 削除(確認つき) */}
          <Card className="border-l-4 border-l-rose-300">
            <details>
              <summary className="cursor-pointer text-sm text-ink/50">危険な操作（この候補者を削除）</summary>
              <form action={deleteCandidateAction} className="mt-3 space-y-2">
                <input type="hidden" name="id" value={c.id} />
                <p className="text-xs text-ink/45">選考履歴・求人紐付け・添付も削除されます。元に戻せません。</p>
                <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 px-3 py-1.5 text-sm hover:bg-rose-100">
                  <Trash2 size={15} /> この候補者を削除する
                </button>
              </form>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}
