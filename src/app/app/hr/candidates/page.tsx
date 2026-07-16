import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createCandidateAction, updateCandidateStatusAction } from "@/server/actions/hr";
import { SubmitButton } from "@/components/ui/submit-button";
import { CANDIDATE_STATUSES, CANDIDATE_STATUS_LABEL, CANDIDATE_CLOSED } from "@/lib/hr-constants";

export const dynamic = "force-dynamic";

interface Candidate {
  id: string; name: string; email: string | null; phone: string | null;
  source: string | null; status: string; created_at: string;
}
interface Opening { id: string; title: string; client_name: string | null; kind: string; status: string; }
interface Link_ { candidate_id: string; job_openings: { title: string } | { title: string }[] | null; }

/** BO-5 候補者パイプライン: 応募→書類→選考→内定→入社。詳細で基本情報/選考履歴/書類を管理。 */
export default async function CandidatesPage() {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const [candR, linkR, openR] = await Promise.all([
    sb.from("candidates").select("id, name, email, phone, source, status, created_at").order("created_at", { ascending: false }).limit(300),
    sb.from("candidate_openings").select("candidate_id, job_openings(title)").limit(2000),
    sb.from("job_openings").select("id, title, client_name, kind, status").order("created_at", { ascending: false }).limit(200),
  ]);
  const candidates = (candR.data ?? []) as Candidate[];
  const openings = (openR.data ?? []) as Opening[];
  const links = (linkR.data ?? []) as Link_[];
  const openingsByCand = new Map<string, string[]>();
  for (const l of links) {
    const jo = Array.isArray(l.job_openings) ? l.job_openings[0] : l.job_openings;
    if (!jo?.title) continue;
    (openingsByCand.get(l.candidate_id) ?? openingsByCand.set(l.candidate_id, []).get(l.candidate_id)!).push(jo.title);
  }
  const inflight = candidates.filter((c) => !CANDIDATE_CLOSED.has(c.status));
  const joined = candidates.filter((c) => c.status === "joined");

  return (
    <div className="max-w-4xl">
      <PageHeader title="候補者" subtitle="採用〜選考のパイプライン。行をクリックすると詳細で基本情報・選考履歴・書類を管理できます。入社にするとタレント台帳へ自動登録されます。" />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">選考中</div><div className="stat-value mt-1">{inflight.length}</div></Card>
        <Card><div className="text-xs text-ink/50">入社・稼働</div><div className="stat-value mt-1 text-teal-deep">{joined.length}</div></Card>
        <Card><div className="text-xs text-ink/50">候補者数</div><div className="stat-value mt-1">{candidates.length}</div></Card>
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
          <SubmitButton className="btn-accent" pendingLabel="追加中…">追加して詳細へ</SubmitButton>
        </form>
      </Section>

      <Section title={`候補者一覧（${candidates.length}）`}>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">候補者がまだいません</p>
        ) : (
          <ul className="space-y-2">
            {candidates.map((c) => {
              const ops = openingsByCand.get(c.id) ?? [];
              const closed = CANDIDATE_CLOSED.has(c.status);
              return (
                <li key={c.id} className={`rounded-xl border border-black/[0.05] p-3 ${closed ? "opacity-60" : ""}`}>
                  <div className="flex items-center gap-2.5 flex-wrap text-sm">
                    <Link href={`/app/hr/candidates/${c.id}`} className="font-medium hover:text-teal-deep inline-flex items-center gap-1">
                      {c.name}<ChevronRight size={14} className="text-ink/30" />
                    </Link>
                    {ops.map((t, i) => <span key={i} className="pill bg-teal-light text-teal-deep text-xs">{t}</span>)}
                    {c.source && <span className="text-xs text-ink/45">{c.source}</span>}
                    {c.email && <span className="text-xs text-ink/40">{c.email}</span>}
                    {/* クイックステータス変更 */}
                    <form action={updateCandidateStatusAction} className="flex items-center gap-1.5 ml-auto">
                      <input type="hidden" name="id" value={c.id} />
                      <select name="status" defaultValue={c.status} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs">
                        {CANDIDATE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      <SubmitButton className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]" pendingLabel="…">変更</SubmitButton>
                    </form>
                    <Link href={`/app/hr/candidates/${c.id}`} className="pill bg-black/[0.04] text-ink/55 text-[10px]">{CANDIDATE_STATUS_LABEL[c.status] ?? c.status}</Link>
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
