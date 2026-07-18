"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sun,
  Target,
  CheckSquare,
  Menu,
  X,
  Timer,
  CalendarCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { navGroupsFor, isBackOfficeOnly, type NavItem } from "@/components/layout/nav-config";
import { RecentList } from "@/components/layout/recent-items";

// ボトムナビ: 外出先で最も使う導線に絞る(残りはメニューから)
const salesTabs: NavItem[] = [
  { href: "/app/dashboard", label: "ホーム", icon: LayoutDashboard },
  { href: "/app/today", label: "今日", icon: Sun },
  { href: "/app/opportunities", label: "案件", icon: Target },
  { href: "/app/tasks", label: "タスク", icon: CheckSquare },
];
const boTabs: NavItem[] = [
  { href: "/app/bo", label: "ホーム", icon: LayoutDashboard },
  { href: "/app/bo/followups", label: "フォロー", icon: CalendarCheck },
  { href: "/app/work", label: "稼働報告", icon: Timer },
];

/**
 * モバイルモードのナビゲーション(md未満のみ表示)。
 * サイドバーの代わりに、親指で届くボトムタブ＋全メニューのドロワーを提供する。
 */
export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navGroups = navGroupsFor(role);
  const boOnly = isBackOfficeOnly(role);
  const tabs = boOnly ? boTabs : salesTabs;

  // 画面遷移したらドロワーを閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // ドロワー表示中は背面のスクロールを止める
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ネストしたパスでは最長一致の項目だけをアクティブにする(サイドバーと同じ規則)
  const allHrefs = [...navGroups.flatMap((g) => g.items.map((i) => i.href)), ...tabs.map((t) => t.href)];
  const bestMatch = Array.from(new Set(allHrefs))
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <>
      {/* ボトムタブバー */}
      <nav
        aria-label="モバイルナビゲーション"
        className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white/95 backdrop-blur pb-safe"
      >
        <div className="flex items-stretch">
          {tabs.map((t) => {
            const active = !open && t.href === bestMatch;
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 min-h-[52px] text-[10px] font-semibold transition-colors",
                  active ? "text-teal-deep" : "text-ink/45 active:text-teal-deep",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                {t.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="全メニューを開く"
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 min-h-[52px] text-[10px] font-semibold transition-colors",
              open ? "text-teal-deep" : "text-ink/45",
            )}
          >
            <Menu size={21} strokeWidth={open ? 2.4 : 2} />
            メニュー
          </button>
        </div>
      </nav>

      {/* 全メニュードロワー */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="メニュー">
          <div className="absolute inset-0 bg-ink/45" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[85vw] max-w-sm bg-white shadow-2xl flex flex-col animate-drawer-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.05] shrink-0">
              <div className="min-w-0">
                <div className="text-teal-deep font-bold text-lg tracking-tight">CATORCE</div>
                <div className="text-[11px] text-ink/40 font-medium mt-0.5 truncate">{APP_NAME}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="メニューを閉じる"
                className="shrink-0 rounded-lg p-2 text-ink/45 hover:bg-teal-light hover:text-teal-deep transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-5 pb-safe">
              {navGroups.map((g) => (
                <div key={g.heading}>
                  <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink/30">
                    {g.heading}
                  </div>
                  <div className="space-y-0.5">
                    {g.items.map((item) => {
                      const active = item.href === bestMatch;
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn("nav-link", active && "nav-link-active")}
                        >
                          <Icon size={18} strokeWidth={2} className="shrink-0" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!boOnly && <RecentList collapsed={false} />}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
