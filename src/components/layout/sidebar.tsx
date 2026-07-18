"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { RecentList } from "@/components/layout/recent-items";
import { navGroupsFor, isBackOfficeOnly } from "@/components/layout/nav-config";

const STORAGE_KEY = "catorce.sidebar.collapsed";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const navGroups = navGroupsFor(role);
  // ネストしたパス(例: /app/analytics/xray)では最長一致の項目だけをアクティブにする
  const bestMatch = navGroups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const boOnly = isBackOfficeOnly(role);
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  // 保存された開閉状態を復元(初回マウント時)。
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* localStorage 不可の環境は既定(展開)のまま */
    }
    setReady(true);
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        // モバイルはボトムナビ＋ドロワー(MobileNav)に切替のためサイドバー非表示
        "hidden md:flex shrink-0 border-r border-black/[0.05] bg-white h-screen sticky top-0 flex-col transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
        // 復元前は再描画のちらつきを抑えるため非表示にしない(既定幅で描画)。
        !ready && "duration-0",
      )}
    >
      <div
        className={cn(
          "border-b border-black/[0.05] flex items-center",
          collapsed ? "justify-center px-2 py-4" : "justify-between px-5 py-5",
        )}
      >
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-teal-deep font-bold text-lg tracking-tight">CATORCE</div>
            <div className="text-[11px] text-ink/40 font-medium mt-0.5 truncate">{APP_NAME}</div>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "メニューを開く" : "メニューを最小化"}
          title={collapsed ? "メニューを開く" : "メニューを最小化"}
          className="shrink-0 rounded-lg p-1.5 text-ink/45 hover:bg-teal-light hover:text-teal-deep transition-colors"
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <nav className={cn("flex-1 overflow-y-auto overflow-x-hidden py-4 space-y-5", collapsed ? "px-2" : "px-3")}>
        {navGroups.map((g) => (
          <div key={g.heading}>
            {collapsed ? (
              <div className="mx-2 mb-1.5 border-t border-black/[0.06]" />
            ) : (
              <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink/30">
                {g.heading}
              </div>
            )}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = item.href === bestMatch;
                const Icon = item.icon;
                // 入れ子表示(└)はラベルから除去してアイコンのみ整列。
                const cleanLabel = item.label.replace(/^└\s*/, "");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? cleanLabel : undefined}
                    className={cn("nav-link", active && "nav-link-active", collapsed && "justify-center px-0")}
                  >
                    <Icon size={17} strokeWidth={2} className="shrink-0" />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      {!boOnly && <RecentList collapsed={collapsed} />}
    </aside>
  );
}
