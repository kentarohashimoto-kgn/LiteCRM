import Link from "next/link";
import { List, CalendarRange, Radar, TrendingUp } from "lucide-react";

export type ProjectView = "list" | "calendar" | "candidates" | "forecast";

const TABS: { key: ProjectView; label: string; icon: typeof List }[] = [
  { key: "list", label: "一覧", icon: List },
  { key: "calendar", label: "カレンダー", icon: CalendarRange },
  { key: "candidates", label: "対象候補", icon: Radar },
  { key: "forecast", label: "見込み", icon: TrendingUp },
];

/** 原価管理の表示切替タブ（一覧 / カレンダー / 対象候補 / 見込み）。URLの?view=で切替。 */
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
            {t.key === "forecast" && forecastAlertCount > 0 && (
              <span className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold ${on ? "bg-white/25 text-white" : "bg-rose-100 text-rose-700"}`}>{forecastAlertCount}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
