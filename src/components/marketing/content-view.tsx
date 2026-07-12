import Link from "next/link";
import { Trash2, Plus, ChevronRight, PenLine, FileText } from "lucide-react";
import { Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate, cn } from "@/lib/utils";
import {
  createContentIdeaAction,
  advanceContentStatusAction,
  deleteContentIdeaAction,
} from "@/server/actions/content-ideas";
import type { ContentIdea, ContentStatus, DesignStatus } from "@/lib/data/content-ideas";

const STATUS_META: Record<ContentStatus, { label: string; cls: string }> = {
  idea: { label: "ネタ", cls: "bg-mist-soft text-ink/60 border border-black/5" },
  selected: { label: "選定", cls: "bg-teal-light text-teal-deep" },
  drafting: { label: "執筆中", cls: "bg-amber-50 text-accent-orange border border-accent-orange/20" },
  published: { label: "公開済", cls: "bg-emerald-100 text-emerald-700" },
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "手動",
  sales_need: "営業ニーズ",
  web_trend: "Webトレンド",
};

const DESIGN_META: Record<DesignStatus, { label: string; cls: string }> = {
  none: { label: "—", cls: "text-ink/30" },
  ready: { label: "連携待ち", cls: "bg-amber-50 text-accent-orange border border-accent-orange/20" },
  linked: { label: "連携済", cls: "bg-teal-primary text-white" },
  manual: { label: "手動", cls: "bg-emerald-100 text-emerald-700" },
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "idea", label: "ネタ" },
  { value: "selected", label: "選定" },
  { value: "drafting", label: "執筆中" },
  { value: "published", label: "公開済" },
];

export function ContentView({
  items,
  counts,
  status,
}: {
  items: ContentIdea[];
  counts: Record<string, number>;
  status: string;
}) {
  return (
    <div className="space-y-6">
      {/* ステータス絞り込み */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = status === f.value;
          const n = f.value ? counts[f.value] ?? 0 : counts.all ?? 0;
          return (
            <a
              key={f.value}
              href={f.value ? `/app/content?status=${f.value}` : "/app/content"}
              className={cn(
                "pill transition-colors",
                active ? "bg-teal-primary text-white" : "bg-mist-soft text-ink/60 hover:bg-teal-light",
              )}
            >
              {f.label}（{n}）
            </a>
          );
        })}
      </div>

      {/* 新規登録 */}
      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-semibold text-teal-deep flex items-center gap-1.5">
          <Plus size={15} /> 記事ネタ・タイトル案を登録する
        </summary>
        <form action={createContentIdeaAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink/50 mb-1">タイトル案<span className="text-rose-500">*</span></label>
            <input name="title" required className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 製造業の現場でAI議事録を定着させる5つのコツ" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">テーマ/切り口</label>
            <input name="theme" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: AI議事録 / 助成金活用" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink/50 mb-1">SEOキーワード</label>
            <input name="target_keyword" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: AI 研修 助成金" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink/50 mb-1">狙い(誰に何を)</label>
            <input name="angle" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 情シス向けに、導入の不安を事例で解消しリード獲得" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink/50 mb-1">メモ</label>
            <input name="note" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <SubmitButton className="btn-primary" pendingLabel="登録中…">登録する</SubmitButton>
          </div>
        </form>
      </details>

      {/* 一覧 */}
      <Section title={`記事パイプライン（${items.length}）`} icon={<PenLine size={15} className="text-teal-primary" />}>
        {items.length === 0 ? (
          <EmptyState message="該当する記事ネタがありません。上の「登録する」から追加できます。将来は営業ニーズ(ノウハウ)＋Web検索から夜間バッチで候補を自動生成します。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th className="th">状態</th>
                  <th className="th">タイトル案</th>
                  <th className="th">本文</th>
                  <th className="th">デザイン</th>
                  <th className="th">テーマ / キーワード</th>
                  <th className="th">出所</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="row-hover border-t border-black/[0.04] align-top">
                    <td className="td"><span className={cn("pill", STATUS_META[c.status].cls)}>{STATUS_META[c.status].label}</span></td>
                    <td className="td">
                      <Link href={`/app/content/${c.id}`} className="font-medium text-ink whitespace-normal max-w-[340px] block hover:text-teal-deep">
                        {c.title}
                      </Link>
                      {c.angle && <div className="text-xs text-ink/50 whitespace-normal max-w-[340px] mt-0.5">{c.angle}</div>}
                    </td>
                    <td className="td">
                      {c.hasDraft ? (
                        <Link href={`/app/content/${c.id}`} className="inline-flex items-center gap-1 text-teal-deep text-xs hover:underline">
                          <FileText size={13} /> あり
                        </Link>
                      ) : (
                        <span className="text-ink/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="td">
                      {c.design_status === "none" ? (
                        <span className={DESIGN_META.none.cls}>—</span>
                      ) : (
                        <span className={cn("pill text-[11px]", DESIGN_META[c.design_status].cls)}>{DESIGN_META[c.design_status].label}</span>
                      )}
                    </td>
                    <td className="td text-ink/70">
                      {c.theme ?? "—"}
                      {c.target_keyword && <div className="text-xs text-ink/45">🔎 {c.target_keyword}</div>}
                    </td>
                    <td className="td text-ink/60">{SOURCE_LABEL[c.source] ?? c.source}<div className="text-[11px] text-ink/35">{formatDate(c.created_at)}</div></td>
                    <td className="td">
                      <div className="flex items-center gap-1 justify-end">
                        {c.status !== "published" && (
                          <form action={advanceContentStatusAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="current" value={c.status} />
                            <button type="submit" className="btn-ghost inline-flex items-center gap-0.5 text-xs" title="次の段階へ">
                              次へ <ChevronRight size={13} />
                            </button>
                          </form>
                        )}
                        <form action={deleteContentIdeaAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="text-ink/30 hover:text-rose-600 transition-colors" title="削除" aria-label="削除">
                            <Trash2 size={15} />
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
