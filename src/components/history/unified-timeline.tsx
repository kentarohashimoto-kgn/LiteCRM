import Link from "next/link";

/**
 * C-1 統合タイムライン: 活動・商談・タスク・ステージ変更・コメント等を
 * 種別を問わず時系列1本で表示する。イベントの組み立ては呼び出し側(サーバー)が行う。
 */
export interface TimelineEvent {
  id: string;
  at: string; // ISO日時 or YYYY-MM-DD
  kind: "activity" | "meeting" | "task" | "stage" | "comment" | "milestone";
  label: string; // pill表示(例: 商談 / 電話 / タスク / ステージ)
  title: string;
  body?: string | null;
  who?: string | null;
  href?: string;
}

const KIND_STYLE: Record<TimelineEvent["kind"], { pill: string; dot: string }> = {
  activity: { pill: "bg-teal-light text-teal-deep", dot: "bg-teal-primary" },
  meeting: { pill: "bg-indigo-50 text-indigo-600", dot: "bg-indigo-400" },
  task: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  stage: { pill: "bg-purple-50 text-purple-600", dot: "bg-purple-400" },
  comment: { pill: "bg-rose-50 text-rose-600", dot: "bg-rose-400" },
  milestone: { pill: "bg-emerald-50 text-emerald-600", dot: "bg-emerald-400" },
};

function fmt(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const base = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  // 日付のみ(時刻情報なし)は日付だけ表示
  if (!at.includes("T") && !at.includes(":")) return base;
  return `${base} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function UnifiedTimeline({ events, limit = 60 }: { events: TimelineEvent[]; limit?: number }) {
  const sorted = events
    .filter((e) => e.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);

  if (sorted.length === 0) {
    return <p className="text-sm text-ink/40 py-4 text-center">まだ記録がありません</p>;
  }

  return (
    <ul className="space-y-3">
      {sorted.map((e) => {
        const s = KIND_STYLE[e.kind];
        return (
          <li key={`${e.kind}-${e.id}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`h-2 w-2 rounded-full mt-1.5 ${s.dot}`} />
              <span className="flex-1 w-px bg-black/[0.06]" />
            </div>
            <div className="pb-2 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`pill ${s.pill}`}>{e.label}</span>
                {e.href ? (
                  <Link href={e.href} className="text-sm font-medium text-ink hover:text-teal-deep hover:underline">{e.title}</Link>
                ) : (
                  <span className="text-sm font-medium text-ink">{e.title}</span>
                )}
              </div>
              {e.body && <p className="text-sm text-ink/60 mt-1 whitespace-pre-line line-clamp-3">{e.body}</p>}
              <div className="text-xs text-ink/40 mt-1">
                {fmt(e.at)}
                {e.who ? ` ・ ${e.who}` : ""}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
