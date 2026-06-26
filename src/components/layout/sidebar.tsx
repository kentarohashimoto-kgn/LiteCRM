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
  UserCog,
  Package,
  Radio,
  Presentation,
  Coins,
  ClipboardList,
  Gauge,
  Star,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

const groups: { heading: string; items: { href: string; label: string; icon: React.ElementType }[] }[] = [
  {
    heading: "営業",
    items: [
      { href: "/app/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
      { href: "/app/reviews/weekly", label: "週次レビュー", icon: CalendarCheck },
      { href: "/app/opportunities", label: "案件", icon: Target },
      { href: "/app/forecast", label: "売上予測", icon: TrendingUp },
      { href: "/app/targets", label: "目標入力", icon: Goal },
    ],
  },
  {
    heading: "経営レビュー",
    items: [
      { href: "/app/exec", label: "週次サマリー", icon: Gauge },
      { href: "/app/exec/kpi", label: "営業KPI振り返り", icon: Goal },
      { href: "/app/exec/deals", label: "商談・読み管理", icon: Target },
      { href: "/app/exec/marketing", label: "マーケ施策管理", icon: Radio },
      { href: "/app/exec/delivery", label: "デリバリー品質", icon: Presentation },
      { href: "/app/exec/projects", label: "開発・顧問案件", icon: Package },
      { href: "/app/exec/actions", label: "アクション管理", icon: CheckSquare },
      { href: "/app/exec/calc", label: "売上逆算", icon: TrendingUp },
      { href: "/app/exec/history", label: "振り返り履歴", icon: ClipboardList },
    ],
  },
  {
    heading: "顧客・活動",
    items: [
      { href: "/app/accounts", label: "顧客", icon: Building2 },
      { href: "/app/srank", label: "Sランク攻略", icon: Star },
      { href: "/app/nurture", label: "既存顧客深耕", icon: TrendingUp },
      { href: "/app/contacts", label: "担当者", icon: Users },
      { href: "/app/leads", label: "リード", icon: Sparkles },
      { href: "/app/tasks", label: "タスク", icon: CheckSquare },
      { href: "/app/activities", label: "活動履歴", icon: ActivityIcon },
    ],
  },
  {
    heading: "分析",
    items: [
      { href: "/app/analytics/revenue", label: "売上・請求分析", icon: Coins },
      { href: "/app/analytics/roi", label: "施策ROI分析", icon: Gauge },
      { href: "/app/analytics/matrix", label: "施策×顧客レベル", icon: Goal },
      { href: "/app/analytics/trends", label: "トレンド分析", icon: TrendingUp },
      { href: "/app/analytics/channels", label: "流入元分析", icon: Radio },
      { href: "/app/analytics/exhibitions", label: "└ 展示会分析", icon: Presentation },
      { href: "/app/analytics/exhibition-roi", label: "└ 展示会(時系列/主催/テーマ)", icon: Presentation },
      { href: "/app/analytics/exhibition-select", label: "└ 展示会選定", icon: Presentation },
      { href: "/app/analytics/seminars", label: "└ セミナー分析", icon: ClipboardList },
      { href: "/app/analytics/seminar-followup", label: "└ セミナー攻略リスト", icon: Star },
      { href: "/app/analytics/sales-reps", label: "営業マン別", icon: UserCog },
      { href: "/app/analytics/products", label: "商品別", icon: Package },
      { href: "/app/analytics/product-roi", label: "プロダクト収益分析", icon: Coins },
    ],
  },
  {
    heading: "設定",
    items: [{ href: "/app/settings", label: "設定", icon: Settings }],
  },
];

const STORAGE_KEY = "catorce.sidebar.collapsed";

export function Sidebar() {
  const pathname = usePathname();
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
        {groups.map((g) => (
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
    </aside>
  );
}
