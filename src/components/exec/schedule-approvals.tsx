import Link from "next/link";
import { Section } from "@/components/ui/primitives";
import { SCHEDULE_TYPE_MAP, APPROVAL_STATUS_LABEL } from "@/lib/constants";
import type { PendingSchedule } from "@/lib/data/schedules";
import { decideScheduleAction } from "@/server/actions/schedules";

export function ScheduleApprovals({ items }: { items: PendingSchedule[] }) {
  return (
    <Section
      title="承認待ちの営業スケジュール分類"
      className="mb-5"
      action={<span className="pill bg-amber-50 text-accent-orange">{items.length}</span>}
    >
      {items.length === 0 ? (
        <p className="text-sm text-ink/40 py-3">承認待ちの分類はありません。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => {
            const meta = SCHEDULE_TYPE_MAP[s.schedule_type];
            return (
              <li key={s.id} className="rounded-xl border border-black/[0.06] p-3">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Link href={`/app/opportunities/${s.opportunity_id}`} className="font-medium text-sm text-ink hover:text-teal-deep">
                    {s.account_name}
                  </Link>
                  <span className="text-xs text-ink/45">{s.opportunity_name}</span>
                  <span className="pill bg-mist-soft text-ink/60 text-[10px] ml-auto">{meta?.label ?? s.schedule_type}</span>
                  {s.approval_status === "needs_revision" && (
                    <span className="pill bg-amber-50 text-accent-orange text-[10px]">{APPROVAL_STATUS_LABEL.needs_revision}</span>
                  )}
                </div>
                <div className="text-xs text-ink/70 mb-2 whitespace-pre-wrap">理由: {s.reason}</div>
                <form action={decideScheduleAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="opportunity_id" value={s.opportunity_id} />
                  <input name="approval_comment" placeholder="コメント（差戻し時は必須推奨）" className="input py-1 text-xs flex-1 min-w-[180px]" />
                  <button type="submit" name="decision" value="approved" className="btn-accent text-xs py-1">承認</button>
                  <button type="submit" name="decision" value="needs_revision" className="btn-ghost text-xs py-1">修正依頼</button>
                  <button type="submit" name="decision" value="rejected" className="text-xs py-1 px-2 rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50">却下</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
