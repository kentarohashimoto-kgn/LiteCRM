"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** 年度切替タブ。?fy=YYYY を付けて遷移する(サーバー側で集計年度を切替)。 */
export function FyTabs({ years, selected, currentFy }: { years: number[]; selected: number; currentFy: number }) {
  const pathname = usePathname();
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-black/10 bg-white p-0.5">
      {years.map((y) => (
        <Link
          key={y}
          href={`${pathname}?fy=${y}`}
          className={cn(
            "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
            y === selected ? "bg-teal-primary text-white" : "text-ink/60 hover:bg-teal-light hover:text-teal-deep",
          )}
        >
          {y}年度{y === currentFy && <span className="ml-1 opacity-70">(今)</span>}
        </Link>
      ))}
    </div>
  );
}
