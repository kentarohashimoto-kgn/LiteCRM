import Link from "next/link";
import { Check, ExternalLink, FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate, formatTimeJst } from "@/lib/utils";
import { markSummaryReviewedAction } from "@/server/actions/review";
import type { PendingSummary } from "@/lib/data/review-queue";

/** 確認キュー本体。AI生成の下書き(要約)を1件ずつ確認する。 */
export function ReviewQueue({ items }: { items: PendingSummary[] }) {
  if (items.length === 0) {
    return (
      <EmptyState message="確認待ちのAI下書きはありません。夜間バッチが議事録を要約すると、ここに「今朝の確認」として並びます。" />
    );
  }

  return (
    <div className="space-y-4">
      {items.map((it) => {
        const detailHref =
          it.opportunityId != null ? `/app/opportunities/${it.opportunityId}/meetings/${it.meetingId}` : null;
        return (
          <div key={it.meetingId} className="card card-pad">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <FileText size={15} className="text-teal-primary shrink-0" />
                  <span className="truncate">{it.accName ?? "—"}</span>
                  {it.oppName && <span className="text-ink/40 truncate">／ {it.oppName}</span>}
                </div>
                <div className="mt-0.5 text-xs text-ink/45">
                  商談日 {formatDate(it.meetingDate)}
                  {it.aiSummaryAt && <span className="ml-2">・AI生成 {formatTimeJst(it.aiSummaryAt)}</span>}
                  <span className="ml-2 pill bg-mist-soft text-ink/60 border border-black/5">AI下書き・未確認</span>
                </div>
              </div>
              {detailHref && (
                <Link href={detailHref} className="btn-ghost shrink-0 inline-flex items-center gap-1 text-xs">
                  <ExternalLink size={13} /> 商談を開いて編集
                </Link>
              )}
            </div>

            <div className="rounded-lg bg-mist-soft/50 border border-black/[0.04] p-3 text-sm text-ink/85 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
              {it.aiSummary}
            </div>

            <div className="mt-3 flex items-center justify-end">
              <form action={markSummaryReviewedAction}>
                <input type="hidden" name="meeting_id" value={it.meetingId} />
                <SubmitButton className="btn-primary inline-flex items-center gap-1.5" pendingLabel="確認中…">
                  <Check size={15} /> 確認済みにする
                </SubmitButton>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}
