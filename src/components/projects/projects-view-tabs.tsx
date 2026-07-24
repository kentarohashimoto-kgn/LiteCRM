import Link from "next/link";
import { List, CalendarRange, Radar } from "lucide-react";

export type ProjectView = "list" | "calendar" | "candidates";

const TABS: { key: ProjectView; label: string; icon: typeof List }[] = [
  { key: "list", label: "一覧", icon: List },
  { key: "calendar", label: "カレンダー（契約＋見込み）", icon: CalendarRange },
  { key: "candidates", label: "対象候補", icon: Radar },
];

/** 原価管理の表示切替タブ。カレンダーは契約(確定)と見込みを統合表示する。URLの?view=で切替。 */
export function ProjectsViewTabs({ view, candidateCount, forecastAlertCount }: { view: ProjectView; candidateCount: number; forecastAlertCount: number }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-mist-soft p-1 mb-4">
      {TABS.map((t) => {
        const on = view === t.key;
        const Icon = t.icon;
        return (
          <Link
            key={t.key}
            href={t.key === "list" ? "/app/projects" : `/app/projects?view=${t.key}`}
            className={`seg ${on ? "seg-on" : "seg-off"}`}
          >
            <Icon size={14} />
            {t.label}
            {t.key === "candidates" && candidateCount > 0 && (
              <span className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold ${on ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>{candidateCount}</span>
            )}
            {t.key === "calendar" && forecastAlertCount > 0 && (
              <span className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold ${on ? "bg-white/25 text-white" : "bg-rose-100 text-rose-700"}`}>{forecastAlertCount}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
