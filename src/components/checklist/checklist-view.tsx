import Link from "next/link";
import { Check, X, ClipboardCheck } from "lucide-react";
import { Section, StatCard, EmptyState, ProgressBar } from "@/components/ui/primitives";
import { formatYen, formatPercent, cn } from "@/lib/utils";
import { CHECKLIST_ITEMS, type ChecklistBoard } from "@/lib/data/checklist";

export function ChecklistView({ board, gapOnly }: { board: ChecklistBoard; gapOnly: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="平均 充足率" raw={formatPercent(board.avgRate)} sub={`必須${CHECKLIST_ITEMS.length}項目の記録率`} />
        <StatCard label="抜けのある案件" raw={`${board.gapCount}`} accent={board.gapCount > 0} sub="件" />
        <StatCard label="表示中" raw={`${board.opps.length}`} sub="件（進行中案件）" />
      </div>

      <div className="flex gap-2">
        <Link href="/app/checklist?gap=1" className={cn("pill transition-colors", gapOnly ? "bg-teal-primary text-white" : "bg-mist-soft text-ink/60 hover:bg-teal-light")}>
          抜けありのみ
        </Link>
        <Link href="/app/checklist" className={cn("pill transition-colors", !gapOnly ? "bg-teal-primary text-white" : "bg-mist-soft text-ink/60 hover:bg-teal-light")}>
          すべて
        </Link>
      </div>

      <Section title="商談チェック（型の必須項目）" icon={<ClipboardCheck size={15} className="text-teal-primary" />}>
        {board.opps.length === 0 ? (
          <EmptyState message={gapOnly ? "抜けのある案件はありません。素晴らしい入力率です。" : "進行中の案件がありません。"} />
        ) : (
          <div className="space-y-2">
            {board.opps.map((o) => (
              <div key={o.id} className="rounded-lg border border-black/[0.06] p-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/app/opportunities/${o.id}`} className="min-w-0 group">
                    <div className="text-sm font-medium text-ink truncate group-hover:text-teal-deep">
                      {o.account ? <span className="text-ink/50">{o.account}／</span> : null}
                      {o.name}
                    </div>
                    <div className="text-xs text-ink/45">{o.yomi ?? "—"} ・ {formatYen(o.amount)}</div>
                  </Link>
                  <div className="shrink-0 w-28">
                    <div className="text-[11px] text-ink/50 text-right mb-1">{o.doneCount}/{o.total}</div>
                    <ProgressBar value={o.doneCount} max={o.total} tone={o.doneCount === o.total ? "teal" : "orange"} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CHECKLIST_ITEMS.map((it) => {
                    const ok = o.done[it.key];
                    return (
                      <span
                        key={it.key}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                          ok ? "bg-emerald-50 text-emerald-700" : "bg-mist-soft text-ink/40",
                        )}
                      >
                        {ok ? <Check size={11} /> : <X size={11} />}
                        {it.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <p className="text-xs text-ink/45">
        ※ 各項目は案件の入力状況（課題・提案内容・次回アクション・決裁者/予算の確認・提案状況）から自動判定します。案件詳細で入力すると即反映されます。
      </p>
    </div>
  );
}
