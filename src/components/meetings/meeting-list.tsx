import Link from "next/link";
import type { MeetingView } from "@/lib/data/select";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

function hm(iso?: string): string | null {
  if (!iso) return null;
  // サーバのローカルTZ(本番はUTC)に依存せず、常にJSTで時刻を表示する。
  // 例: 2026-07-06T13:00+09:00 は getHours() だと 04 になってしまうため +9h して整形。
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 案件配下の商談リスト。商談日・時間・概要を把握しやすく表示。 */
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
      {meetings.map((m) => {
        const time = hm(m.meeting_at);
        return (
          <li key={m.id} className="py-2.5">
            <Link href={`/app/opportunities/${m.opportunity_id}/meetings/${m.id}`} className="group flex gap-3">
              <div className="shrink-0 w-16 text-center">
                <div className="text-sm font-semibold tabular-nums text-ink leading-tight">{formatDate(m.meeting_date ?? m.meeting_at)}</div>
                <div className={`text-xs tabular-nums ${time ? "text-teal-deep font-medium" : "text-ink/30"}`}>{time ?? "時刻未設定"}</div>
              </div>
              <div className="min-w-0 flex-1 border-l border-black/[0.05] pl-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Avatar user={m.owner} size={18} />
                  <span className="truncate text-sm font-medium text-ink group-hover:text-teal-deep">{m.title}</span>
                  {m.method && <span className="pill bg-mist-soft text-ink/60 text-[10px]">{m.method}</span>}
                  {m.minutes_detail && <span className="pill bg-teal-light text-teal-deep text-[10px]">議事録</span>}
                  {m.owner && <span className="text-[11px] text-ink/45">{m.owner.name}</span>}
                </div>
                {showOpportunity && m.opportunity && <div className="text-[11px] text-ink/45 truncate mt-0.5">案件: {m.opportunity.name}</div>}
                {m.summary && <p className="text-xs text-ink/60 mt-1 line-clamp-2">{m.summary}</p>}
                {m.next_action_date && <div className="text-[11px] text-ink/40 mt-1">次アクション: {formatDate(m.next_action_date)}{m.next_action_text ? ` ・ ${m.next_action_text}` : ""}</div>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
