"use client";

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
  Settings,
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
    heading: "顧客・活動",
    items: [
      { href: "/app/accounts", label: "顧客", icon: Building2 },
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
      { href: "/app/analytics/channels", label: "流入元分析", icon: Radio },
      { href: "/app/analytics/exhibitions", label: "└ 展示会分析", icon: Presentation },
      { href: "/app/analytics/sales-reps", label: "営業マン別", icon: UserCog },
      { href: "/app/analytics/products", label: "商品別", icon: Package },
    ],
  },
  {
    heading: "設定",
    items: [{ href: "/app/settings", label: "設定", icon: Settings }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-black/[0.05] bg-white h-screen sticky top-0 flex flex-col">
      <div className="px-5 py-5 border-b border-black/[0.05]">
        <div className="text-teal-deep font-bold text-lg tracking-tight">CATORCE</div>
        <div className="text-[11px] text-ink/40 font-medium mt-0.5">{APP_NAME}</div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groups.map((g) => (
          <div key={g.heading}>
            <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink/30">
              {g.heading}
            </div>
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("nav-link", active && "nav-link-active")}
                  >
                    <Icon size={17} strokeWidth={2} />
                    {item.label}
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
