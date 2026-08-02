import { NotebookPen, Mic, Plus, Search } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { listMemoPages } from "@/lib/data/memos";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { MemoListView } from "@/components/memos/memo-list-view";
import { createMemoPageAction } from "@/server/actions/memos";

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
          <MemoListView pages={pages} />
        )}
      </Section>
    </div>
  );
}
