import Link from "next/link";
import { NotebookPen, Mic, Plus, Search, FileText, Link2, CornerDownRight } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { listMemoPages } from "@/lib/data/memos";
import { MEMO_KIND_LABEL } from "@/lib/memo";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { createMemoPageAction } from "@/server/actions/memos";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * メモ・議事録の一覧。Notionライクに「まず白紙ページを作って書き始める」導線を最上部に置く。
 * ページは後から案件・商談に紐付けられる（紐付け済みはピルで表示）。
 */
export default async function MemosPage({ searchParams }: { searchParams: { q?: string; error?: string } }) {
  await requireCtx();
  const q = (searchParams.q ?? "").trim();
  const pages = await listMemoPages(q);

  return (
    <div>
      <PageHeader
        title="メモ・議事録"
        subtitle="1クリックで白紙ページを作成。議事録は録音からの自動文字起こしにも対応。後からCRMの案件・商談に紐付けられます。"
      />

      {searchParams.error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">{searchParams.error}</div>
      )}

      {/* すぐ書き始める */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form action={createMemoPageAction}>
          <input type="hidden" name="kind" value="memo" />
          <SubmitButton className="btn-primary" pendingLabel="作成中…">
            <Plus size={15} /> 新しいメモ
          </SubmitButton>
        </form>
        <form action={createMemoPageAction}>
          <input type="hidden" name="kind" value="minutes" />
          <SubmitButton className="btn-ghost" pendingLabel="作成中…">
            <Mic size={15} /> 新しい議事録（録音対応）
          </SubmitButton>
        </form>
        <form method="GET" className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="タイトル・本文を検索"
              className="input !w-56 !pl-8"
              aria-label="検索"
            />
          </div>
        </form>
      </div>

      <Section title={`ページ一覧（${pages.length}件）`} icon={<NotebookPen size={15} />}>
        {pages.length === 0 ? (
          <EmptyState
            message={
              q
                ? `「${q}」に一致するページはありません。`
                : "まだページがありません。上の「新しいメモ」「新しい議事録」からすぐに書き始められます。"
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pages.map((p) => (
              <Link
                key={p.id}
                href={`/app/memos/${p.id}`}
                className="block rounded-xl border border-black/[0.06] p-4 hover:border-teal-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-bold text-ink line-clamp-1">{p.title}</span>
                  <span className={`pill shrink-0 ${p.kind === "minutes" ? "bg-teal-light text-teal-deep" : "bg-mist-soft text-ink/60"}`}>
                    {MEMO_KIND_LABEL[p.kind]}
                  </span>
                </div>
                {p.parentTitle && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/40">
                    <CornerDownRight size={11} /> {p.parentTitle}
                  </div>
                )}
                {p.bodyPreview && <p className="mt-1 line-clamp-2 text-xs text-ink/50 whitespace-pre-wrap">{p.bodyPreview}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink/45">
                  {p.oppName && (
                    <span className="pill bg-amber-50 text-accent-orange inline-flex items-center gap-1">
                      <Link2 size={10} /> {p.oppName}
                      {p.meetingTitle ? ` / ${p.meetingTitle}` : ""}
                    </span>
                  )}
                  {p.recordingCount > 0 && (
                    <span className="pill bg-rose-50 text-rose-600 inline-flex items-center gap-1">
                      <Mic size={10} /> 録音 {p.recordingCount}
                    </span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
                    <FileText size={11} /> {formatDateTimeJst(p.updated_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
