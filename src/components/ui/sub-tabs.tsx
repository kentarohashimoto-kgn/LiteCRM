"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SubTab = { href: string; label: string; exact?: boolean };

/**
 * ページ群を1つのハブに見せるリンクタブ(IA再編 STEP 2)。
 * TasksNav と同スタイル。URLはそのままにタブで行き来できるようにする。
 */
export function SubTabs({ tabs }: { tabs: SubTab[] }) {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b border-black/[0.06] mb-5 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors",
              active ? "border-teal-primary text-teal-deep" : "border-transparent text-ink/45 hover:text-ink/70",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
