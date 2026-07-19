import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { listKnowledge, filterKnowledge } from "@/lib/data/knowledge";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";

export const dynamic = "force-dynamic";

/**
 * B7 ノウハウ・事例ナレッジベース。
 * 商談で得たノウハウ(成功/失敗)、成約/失注理由、刺さる事例(自社/他社)を蓄積し検索する。
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: { q?: string; kind?: string };
}) {
  await requireCtx();
  const all = await listKnowledge();

  const q = searchParams.q ?? "";
  const kind = searchParams.kind ?? "";
  const entries = filterKnowledge(all, q, kind);

  const counts: Record<string, number> = { all: all.length };
  for (const e of all) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

  return (
    <div>
      <PageHeader
        title="ノウハウ・事例"
        subtitle="商談で得たノウハウ・成約/失注理由・刺さる事例を蓄積し、必要なときに検索して引き出します。"
        action={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs font-semibold">
            <Link href="/app/playbooks" className="text-teal-primary hover:underline">カトルセの型 →</Link>
            <Link href="/app/content" className="text-teal-primary hover:underline">記事ネタ・ブログ →</Link>
          </div>
        }
      />
      <KnowledgeView entries={entries} counts={counts} q={q} kind={kind} />
    </div>
  );
}
