import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { OpeningForm, type OpeningRecord } from "@/components/hr/opening-form";
import { updateJobOpeningStatusAction, deleteJobOpeningAction } from "@/server/actions/hr";
import { KIND_LABEL, OPENING_STATUSES, OPENING_STATUS_LABEL, CLOSE_REASONS, CANDIDATE_STATUS_LABEL, CANDIDATE_CLOSED } from "@/lib/hr-constants";
import { CandidateMetaLine } from "@/components/hr/candidate-meta";

export const dynamic = "force-dynamic";

const COLS =
  "id, kind, title, client_name, role_description, rate_note, status, close_reason, headcount, priority, work_style, employment_types, workload, pay_rate, start_on, required_skills, recruit_channel, end_client, upstream_company, distribution, client_rate, pay_limit, expected_margin, settlement_terms, payment_site, interview_count, project_start_on, project_end_on, opened_at";

type Row = OpeningRecord & { status: string; close_reason: string | null; opened_at: string };

interface CandRow { id: string; name: string; status: string; age: number | null; desired_workload: string | null; desired_pay: string | null; notes: string | null; }
interface CandLink { id: string; role_note: string | null; candidates: CandRow | CandRow[] | null; }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/** 求人案件 詳細/編集ページ。区分別の全項目編集・ステータス管理・削除。 */
export default async function OpeningDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { saved?: string; error?: string };
}) {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const { data } = await sb.from("job_openings").select(COLS).eq("id", params.id).maybeSingle();
  if (!data) notFound();
  const o = data as Row;
  const { data: candLinks } = await sb
    .from("candidate_openings")
    .select("id, role_note, candidates(id, name, status, age, desired_workload, desired_pay, notes)")
    .eq("job_opening_id", o.id)
    .order("created_at", { ascending: false });
  const linkedCands = ((candLinks ?? []) as CandLink[])
    .map((l) => ({ link: l, cand: one(l.candidates) }))
    .filter((x): x is { link: CandLink; cand: CandRow } => !!x.cand);
  const candCount = linkedCands.length;

  return (
    <div className="max-w-3xl">
      <Link href="/app/hr/openings" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 求人一覧
      </Link>

      <PageHeader
        title={o.title}
        subtitle={`${KIND_LABEL[o.kind] ?? o.kind}${o.client_name ? "・" + o.client_name : ""}`}
        action={<span className={`pill ${o.status === "closed" ? "bg-ink/10 text-ink/50" : "bg-teal-light text-teal-deep"}`}>{OPENING_STATUS_LABEL[o.status] ?? o.status}{o.status === "closed" && o.close_reason ? `（${o.close_reason}）` : ""}</span>}
      />

      {searchParams.saved && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">保存しました。</div>
      )}
      {searchParams.error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">入力に不備があり保存できませんでした。</div>
      )}

      {/* ステータス管理 */}
      <Section title="ステータス" className="mb-5">
        <form action={updateJobOpeningStatusAction} className="flex flex-wrap items-end gap-2.5">
          <input type="hidden" name="id" value={o.id} />
          <div>
            <label className="label">状態</label>
            <select name="status" defaultValue={o.status} className="input w-auto">
              {OPENING_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">クローズ理由（クローズ時）</label>
            <select name="close_reason" defaultValue={o.close_reason ?? ""} className="input w-auto">
              <option value="">—</option>
              {CLOSE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <SubmitButton className="btn-ghost" pendingLabel="更新中…">状態を更新</SubmitButton>
          <span className="text-xs text-ink/45 ml-1">候補者 {candCount}名 ・ {o.opened_at}〜</span>
        </form>
        <p className="text-xs text-ink/40 mt-2">「クローズ」→「募集中」に戻すと、クローズ理由は自動でクリアされます（充足はクローズ理由に含まれます）。</p>
      </Section>

      {/* 紐付き候補者(候補者一覧と同じ主要条件を表示) */}
      <Section title={`紐付き候補者（${candCount}）`} className="mb-5">
        {candCount === 0 ? (
          <p className="text-sm text-ink/40 py-2">この求人に紐付いた候補者はまだいません。候補者ページから紐付けできます。</p>
        ) : (
          <ul className="space-y-2">
            {linkedCands.map(({ link, cand }) => (
              <li key={link.id} className={`rounded-xl border border-black/[0.05] p-3 ${CANDIDATE_CLOSED.has(cand.status) && cand.status !== "joined" ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-2.5 flex-wrap text-sm">
                  <Link href={`/app/hr/candidates/${cand.id}`} className="font-medium hover:text-teal-deep">{cand.name}</Link>
                  <span className={`pill text-[10px] ${cand.status === "joined" ? "bg-teal-light text-teal-deep" : "bg-black/[0.04] text-ink/55"}`}>{CANDIDATE_STATUS_LABEL[cand.status] ?? cand.status}</span>
                  {link.role_note && <span className="text-xs text-ink/45">{link.role_note}</span>}
                </div>
                <CandidateMetaLine c={cand} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 全項目編集(区分別) */}
      <Section title="求人内容の編集" className="mb-5">
        <OpeningForm opening={o} />
      </Section>

      {/* 削除(確認つき) */}
      <Card className="border-l-4 border-l-rose-300">
        <details>
          <summary className="cursor-pointer text-sm text-ink/50">危険な操作（この求人を削除）</summary>
          <form action={deleteJobOpeningAction} className="mt-3 flex items-center gap-3 flex-wrap">
            <input type="hidden" name="id" value={o.id} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 px-3 py-1.5 text-sm hover:bg-rose-100">
              <Trash2 size={15} /> この求人を削除する
            </button>
            <span className="text-xs text-ink/40">紐付く候補者の求人リンクも解除されます（候補者自体は削除されません）。</span>
          </form>
        </details>
      </Card>
    </div>
  );
}
