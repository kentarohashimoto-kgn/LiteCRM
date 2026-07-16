import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createJobOpeningAction } from "@/server/actions/hr";
import { SubmitButton } from "@/components/ui/submit-button";
import { KIND_LABEL, OPENING_STATUS_LABEL, PRIORITY_LABEL } from "@/lib/hr-constants";

export const dynamic = "force-dynamic";

interface Opening {
  id: string; kind: string; title: string; client_name: string | null;
  role_description: string | null; status: string; close_reason: string | null;
  priority: string | null; headcount: number | null; opened_at: string;
}

/** BO-5 求人案件: クライアント案件(SES/講師派遣等)とカトルセ社内採用の募集を一元管理。 */
export default async function OpeningsPage() {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const [openingsR, linkR] = await Promise.all([
    sb.from("job_openings").select("id, kind, title, client_name, role_description, status, close_reason, priority, headcount, opened_at").order("created_at", { ascending: false }).limit(200),
    sb.from("candidate_openings").select("job_opening_id"),
  ]);
  const openings = (openingsR.data ?? []) as Opening[];
  const candCount = new Map<string, number>();
  for (const c of linkR.data ?? []) {
    const k = c.job_opening_id as string;
    candCount.set(k, (candCount.get(k) ?? 0) + 1);
  }
  const active = openings.filter((o) => o.status === "open" || o.status === "interviewing");

  return (
    <div className="max-w-4xl">
      <PageHeader title="求人案件" subtitle="クライアント案件とカトルセ人員の募集をまとめて管理します。行をクリックすると詳細で全項目を編集できます。" />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">募集中・選考中</div><div className="stat-value mt-1">{active.length}</div></Card>
        <Card><div className="text-xs text-ink/50">クライアント案件</div><div className="stat-value mt-1">{active.filter((o) => o.kind === "client").length}</div></Card>
        <Card><div className="text-xs text-ink/50">カトルセ人員</div><div className="stat-value mt-1">{active.filter((o) => o.kind === "internal").length}</div></Card>
      </div>

      <Section title="求人案件を追加" className="mb-5">
        <form action={createJobOpeningAction} className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="label">区分 *</label>
            <select name="kind" className="input w-auto" defaultValue="internal">
              <option value="internal">カトルセ人員</option>
              <option value="client">クライアント案件</option>
            </select>
          </div>
          <div><label className="label">ポジション名 *</label><input name="title" required className="input" placeholder="例: AI講師 / 開発エンジニア" /></div>
          <div><label className="label">クライアント名（クライアント案件のみ）</label><input name="client_name" className="input" /></div>
          <SubmitButton className="btn-accent" pendingLabel="追加中…">追加して詳細へ</SubmitButton>
        </form>
        <p className="text-xs text-ink/40 mt-2">追加後、詳細ページで区分に応じた詳細項目（募集要件・単価・条件など）を入力できます。</p>
      </Section>

      <Section title={`求人一覧（${openings.length}）`}>
        {openings.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">求人案件がまだありません</p>
        ) : (
          <ul className="space-y-2">
            {openings.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/app/hr/openings/${o.id}`}
                  className={`block rounded-xl border border-black/[0.05] p-3 hover:border-teal-primary/40 hover:bg-teal-light/10 transition-colors ${o.status === "closed" ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-2.5 flex-wrap text-sm">
                    <span className={`pill ${o.kind === "client" ? "bg-indigo-50 text-indigo-700" : "bg-teal-light text-teal-deep"}`}>{KIND_LABEL[o.kind] ?? o.kind}</span>
                    <span className="font-medium">{o.title}</span>
                    {o.client_name && <span className="text-xs text-ink/45">{o.client_name}</span>}
                    {o.priority && <span className="pill bg-black/[0.04] text-ink/55 text-[10px]">優先度: {PRIORITY_LABEL[o.priority] ?? o.priority}</span>}
                    {o.headcount != null && <span className="text-xs text-ink/45">募集 {o.headcount}名</span>}
                    <span className="text-xs text-ink/40">候補者 {candCount.get(o.id) ?? 0}名</span>
                    <span className={`pill text-[10px] ml-auto ${o.status === "closed" ? "bg-ink/10 text-ink/50" : "bg-teal-primary text-white"}`}>
                      {OPENING_STATUS_LABEL[o.status] ?? o.status}{o.status === "closed" && o.close_reason ? `（${o.close_reason}）` : ""}
                    </span>
                    <ChevronRight size={16} className="text-ink/30" />
                  </div>
                  {o.role_description && <p className="text-xs text-ink/55 mt-1.5 line-clamp-2 whitespace-pre-wrap">{o.role_description}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
