import { Trash2, Plus, Search, Lightbulb } from "lucide-react";
import { Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate, cn } from "@/lib/utils";
import { createKnowledgeAction, deleteKnowledgeAction } from "@/server/actions/knowledge";
import type { KnowledgeEntry, KnowledgeKind } from "@/lib/data/knowledge";

const KIND_META: Record<KnowledgeKind, { label: string; cls: string }> = {
  knowhow: { label: "ノウハウ", cls: "bg-teal-light text-teal-deep" },
  win_reason: { label: "成約理由", cls: "bg-emerald-100 text-emerald-700" },
  loss_reason: { label: "失注理由", cls: "bg-rose-100 text-rose-600" },
  case_study: { label: "事例", cls: "bg-amber-50 text-accent-orange border border-accent-orange/20" },
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
            <option value="">すべて（{entries.length && !kind && !q ? counts.all : counts.all}）</option>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}（{counts[k] ?? 0}）
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">検索</button>
        {(q || kind) && (
          <a href="/app/knowledge" className="btn-ghost">クリア</a>
        )}
      </form>

      {/* 新規登録(折りたたみ) */}
      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-semibold text-teal-deep flex items-center gap-1.5">
          <Plus size={15} /> ノウハウ・事例を登録する
        </summary>
        <form action={createKnowledgeAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">種別</label>
            <select name="kind" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm">
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>{KIND_META[k].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">業種(任意)</label>
            <input name="industry" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 建築 / 製造 / ISP" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink/50 mb-1">タイトル<span className="text-rose-500">*</span></label>
            <input name="title" required className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 助成金トークで価格ハードルを下げた / 官公庁は閉域が前提" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink/50 mb-1">内容</label>
            <textarea name="body" rows={4} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="どんな状況で・何が効いた/失敗したか。次に活かせる形で。" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">競合(任意)</label>
            <input name="competitor" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="失注理由・事例で該当あれば" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">タグ(任意・カンマ区切り)</label>
            <input name="tags" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="価格, 決裁, 助成金" />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input type="checkbox" name="is_own_company" defaultChecked className="rounded" /> 自社の事例・ノウハウ（外すと他社事例）
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <SubmitButton className="btn-primary" pendingLabel="登録中…">登録する</SubmitButton>
          </div>
        </form>
      </details>

      {/* 一覧 */}
      <Section
        title={`ナレッジ（${entries.length}件）`}
        icon={<Lightbulb size={15} className="text-accent-orange" />}
      >
        {entries.length === 0 ? (
          <EmptyState message={q || kind ? "該当するノウハウ・事例がありません。条件を変えてください。" : "まだ登録がありません。上の「登録する」から、商談で得たノウハウ・成約/失注理由・刺さった事例を蓄積しましょう。"} />
        ) : (
          <div className="space-y-3">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border border-black/[0.06] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={cn("pill", KIND_META[e.kind].cls)}>{KIND_META[e.kind].label}</span>
                      {e.kind === "case_study" && (
                        <span className="pill bg-mist-soft text-ink/60 border border-black/5">{e.is_own_company ? "自社" : "他社"}</span>
                      )}
                      {e.industry && <span className="text-xs text-ink/50">業種: {e.industry}</span>}
                      {e.competitor && <span className="text-xs text-ink/50">競合: {e.competitor}</span>}
                    </div>
                    <div className="text-sm font-semibold text-ink">{e.title}</div>
                  </div>
                  <form action={deleteKnowledgeAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <button type="submit" className="text-ink/30 hover:text-rose-600 transition-colors shrink-0" title="削除" aria-label="削除">
                      <Trash2 size={15} />
                    </button>
                  </form>
                </div>
                {e.body && <div className="mt-1.5 text-sm text-ink/75 whitespace-pre-wrap leading-relaxed">{e.body}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(e.tags ?? []).map((t) => (
                    <span key={t} className="pill bg-mist-soft text-ink/60 text-[11px]">#{t}</span>
                  ))}
                  <span className="ml-auto text-[11px] text-ink/35">{formatDate(e.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
