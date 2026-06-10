import Link from "next/link";
import type { MeetingView } from "@/lib/data/select";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

/** 案件配下の商談リスト。各行は商談詳細へリンク。 */
export function MeetingList({
  meetings,
  showOpportunity = false,
  emptyMessage = "商談はまだありません",
}: {
  meetings: MeetingView[];
  showOpportunity?: boolean;
  emptyMessage?: string;
}) {
  if (meetings.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <ul className="divide-y divide-black/[0.05]">
      {meetings.map((m) => (
        <li key={m.id} className="py-2.5">
          <Link
            href={`/app/opportunities/${m.opportunity_id}/meetings/${m.id}`}
            className="group flex items-center gap-3"
          >
            <Avatar user={m.owner} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink group-hover:text-teal-deep">{m.title}</span>
                {m.method && <span className="pill bg-mist-soft text-ink/60 text-[10px]">{m.method}</span>}
              </div>
              {showOpportunity && m.opportunity && (
                <div className="text-[11px] text-ink/45 truncate">案件: {m.opportunity.name}</div>
              )}
              {m.summary && <div className="text-xs text-ink/50 truncate mt-0.5">{m.summary}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-medium tabular-nums text-ink">{formatDate(m.meeting_date)}</div>
              {m.next_action_date && <div className="text-[11px] text-ink/40">次:{formatDate(m.next_action_date)}</div>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
