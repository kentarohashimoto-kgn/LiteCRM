"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";

const KEY = "catorce.recent.v1";
const MAX = 6;

export interface RecentItem { href: string; label: string; kind: "案件" | "顧客" | "リード"; }

function read(): RecentItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentItem[]; } catch { return []; }
}

/** 詳細ページに置くと閲覧履歴を記録する(表示なし)。 */
export function RecordRecent({ href, label, kind }: RecentItem) {
  useEffect(() => {
    try {
      const cur = read().filter((r) => r.href !== href);
      cur.unshift({ href, label, kind });
      localStorage.setItem(KEY, JSON.stringify(cur.slice(0, MAX)));
    } catch { /* noop */ }
  }, [href, label, kind]);
  return null;
}

/** サイドバー下部の「最近見た項目」。 */
export function RecentList({ collapsed }: { collapsed: boolean }) {
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    setItems(read());
    const onFocus = () => setItems(read());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  if (collapsed || items.length === 0) return null;
  return (
    <div className="px-3 pb-3">
      <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink/30 flex items-center gap-1">
        <History size={11} /> 最近見た項目
      </div>
      <ul className="space-y-0.5">
        {items.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs text-ink/60 hover:bg-mist-soft hover:text-ink">
              <span className="pill bg-mist-soft text-ink/40 text-[9px] shrink-0">{r.kind}</span>
              <span className="truncate">{r.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
