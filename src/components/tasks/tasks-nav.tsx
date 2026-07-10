"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, FolderKanban, LayoutList, Target, BarChart3, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/app/tasks", label: "マイタスク", icon: CheckCircle2, exact: true },
  { href: "/app/tasks/projects", label: "プロジェクト", icon: FolderKanban },
  { href: "/app/tasks/portfolios", label: "ポートフォリオ", icon: LayoutList },
  { href: "/app/tasks/goals", label: "ゴール", icon: Target },
  { href: "/app/tasks/reports", label: "レポート", icon: BarChart3 },
  { href: "/app/tasks/meetings", label: "商談フォロー", icon: CalendarClock },
];

export function TasksNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b border-black/[0.06] mb-5 overflow-x-auto">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + "/");
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors",
              active ? "border-teal-primary text-teal-deep" : "border-transparent text-ink/45 hover:text-ink/70",
            )}
          >
            <Icon size={15} />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
