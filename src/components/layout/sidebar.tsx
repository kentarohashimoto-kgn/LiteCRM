"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Target,
  CalendarCheck,
  Building2,
  Users,
  Sparkles,
  CheckSquare,
  Activity as ActivityIcon,
  TrendingUp,
  Goal,
  Presentation,
  ClipboardList,
  Gauge,
  Star,
  UserCog,
  Settings,
  Sun,
  BadgeCheck,
  BookOpen,
  Briefcase,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { RecentList } from "@/components/layout/recent-items";

const groups: { heading: string; items: { href: string; label: string; icon: React.ElementType }[] }[] = [
  {
    heading: "ホーム",
    items: [
      { href: "/app/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
      { href: "/app/today", label: "今日のアポ・AC", icon: Sun },
      { href: "/app/tasks", label: "タスク", icon: CheckSquare },
      { href: "/app/activities", label: "活動履歴", icon: ActivityIcon },
    ],
  },
  {
    heading: "案件",
    items: [
      { href: "/app/appointments/new", label: "アポ登録", icon: CalendarCheck },
      { href: "/app/opportunities", label: "案件（表・ボード）", icon: Target },
      { href: "/app/reps", label: "営業ビュー", icon: UserCog },
      { href: "/app/forecast", label: "売上予測", icon: TrendingUp },
      { href: "/app/targets", label: "目標入力", icon: Goal },
    ],
  },
  {
    heading: "顧客",
    items: [
      { href: "/app/accounts", label: "顧客", icon: Building2 },
      { href: "/app/contacts", label: "担当者", icon: Users },
      { href: "/app/leads", label: "リード", icon: Sparkles },
      { href: "/app/srank", label: "Sランク攻略", icon: Star },
      { href: "/app/nurture", label: "既存顧客深耕", icon: TrendingUp },
    ],
  },
  {
    heading: "分析・レビュー",
    items: [
      { href: "/app/analytics", label: "分析ハブ", icon: Gauge },
      { href: "/app/exec", label: "経営レビュー", icon: Presentation },
      { href: "/app/reviews/weekly", label: "週次レビュー", icon: CalendarCheck },
    ],
  },
  {
    heading: "設定",
    items: [
      { href: "/app/settings", label: "設定", icon: Settings },
      { href: "/app/opportunities/import", label: "データ取込", icon: ClipboardList },
    ],
  },
];

// バックオフィス領域(事務/人事/管理者)のナビ
const boGroups: typeof groups = [
  {
    heading: "バックオフィス",
    items: [
      { href: "/app/bo", label: "BOダッシュボード", icon: LayoutDashboard },
      { href: "/app/bo/subsidies", label: "助成金トラッカー", icon: BadgeCheck },
      { href: "/app/bo/followups", label: "研修後フォロー", icon: CalendarCheck },
      { href: "/app/bo/expos", label: "展示会準備WBS", icon: Presentation },
      { href: "/app/bo/instructors", label: "AI講師スケジュール", icon: CalendarCheck },
      { href: "/app/bo/cases", label: "事例・インタビュー", icon: BookOpen },
      { href: "/app/bo/surveys", label: "講師アンケート", icon: ClipboardList },
    ],
  },
];
const hrGroup: (typeof groups)[number] = {
  heading: "人事",
  items: [
    { href: "/app/hr/openings", label: "求人案件", icon: Briefcase },
    { href: "/app/hr/candidates", label: "候補者", icon: Users },
    { href: "/app/hr/talents", label: "タレント台帳・評価", icon: Star },
  ],
};

/** ロールに応じたナビ(営業⇔BOの相互不可視、管理者は全部)。 */
function groupsFor(role: Role): typeof groups {
  if (role === "back_office") return boGroups;
  if (role === "hr") return [...boGroups, hrGroup];
  if (role === "owner" || role === "admin") return [...groups, ...boGroups, hrGroup];
  return groups; // 営業系ロール
}

const STORAGE_KEY = "catorce.sidebar.collapsed";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const navGroups = groupsFor(role);
  const boOnly = role === "back_office" || role === "hr";
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
        "shrink-0 border-r border-black/[0.05] bg-white h-screen sticky top-0 flex flex-col transition-[width] duration-200",
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
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
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
