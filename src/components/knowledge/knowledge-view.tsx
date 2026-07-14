import { Plus, Search, Lightbulb } from "lucide-react";
import { Section, EmptyState } from "@/components/ui/primitives";
import { KnowledgeCard } from "@/components/knowledge/knowledge-card";
import { KnowledgeEditor } from "@/components/knowledge/knowledge-editor";
import type { KnowledgeEntry, KnowledgeKind } from "@/lib/data/knowledge";

const KIND_META: Record<KnowledgeKind, { label: string }> = {
  knowhow: { label: "ノウハウ" },
  win_reason: { label: "成約理由" },
  loss_reason: { label: "失注理由" },
  case_study: { label: "事例" },
};
const KIND_ORDER: KnowledgeKind[] = ["knowhow", "win_reason", "loss_reason", "case_study"];

export function KnowledgeView({
  entries,
  counts,
  q,
  kind,
}: {
  entries: KnowledgeEntry[];
  counts: Record<string, number>;
  q: string;
  kind: string;
}) {
  return (
    <div className="space-y-6">
      {/* 検索 */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-semibold text-ink/50 mb-1">キーワード検索</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              name="q"
              defaultValue={q}
              placeholder="課題・業種・競合・タグなどで検索"
              className="w-full rounded-lg border border-black/10 pl-9 pr-3 py-2 text-sm focus:border-teal-primary focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink/50 mb-1">種別</label>
          <select name="kind" defaultValue={kind} className="rounded-lg border border-black/10 px-3 py-2 text-sm">
            <option value="">すべて（{counts.all}）</option>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}（{counts[k] ?? 0}）
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">検索</button>
        {(q || kind) && <a href="/app/knowledge" className="btn-ghost">クリア</a>}
      </form>

      {/* 新規登録(折りたたみ) */}
      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-semibold text-teal-deep flex items-center gap-1.5">
          <Plus size={15} /> ノウハウ・事例を登録する
        </summary>
        <div className="mt-4">
          <KnowledgeEditor />
        </div>
      </details>

      {/* 一覧 */}
      <Section title={`ナレッジ（${entries.length}件）`} icon={<Lightbulb size={15} className="text-accent-orange" />}>
        {entries.length === 0 ? (
          <EmptyState
            message={
              q || kind
                ? "該当するノウハウ・事例がありません。条件を変えてください。"
                : "まだ登録がありません。上の「登録する」から、商談で得たノウハウ・成約/失注理由・刺さった事例を蓄積しましょう。"
            }
          />
        ) : (
          <div className="space-y-3">
            {entries.map((e) => (
              <KnowledgeCard key={e.id} entry={e} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
