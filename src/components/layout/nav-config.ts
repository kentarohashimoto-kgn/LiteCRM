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
  ScanLine,
  Contact,
  FolderKanban,
  Bot,
  Inbox,
  History,
  Lightbulb,
  Swords,
  PenLine,
  Scale,
  ClipboardCheck,
  NotebookPen,
  Timer,
  ArrowRightLeft,
  Workflow,
  Mail,
  Telescope,
} from "lucide-react";
import { canManageProjects } from "@/lib/constants";
import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}
export interface NavGroup {
  heading: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    heading: "ホーム",
    items: [
      { href: "/app/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
      { href: "/app/today", label: "今日のアポ・AC", icon: Sun },
      { href: "/app/review", label: "AI確認キュー", icon: Inbox },
      { href: "/app/checklist", label: "商談チェック", icon: ClipboardCheck },
      { href: "/app/tasks", label: "タスク", icon: CheckSquare },
      { href: "/app/activities", label: "活動履歴", icon: ActivityIcon },
    ],
  },
  {
    heading: "案件",
    items: [
      { href: "/app/appointments/new", label: "アポ・商談登録", icon: CalendarCheck },
      { href: "/app/opportunities", label: "案件（表・ボード）", icon: Target },
      { href: "/app/reps", label: "営業ビュー", icon: UserCog },
      { href: "/app/forecast", label: "売上予測", icon: TrendingUp },
      { href: "/app/targets", label: "目標入力", icon: Goal },
      { href: "/app/work", label: "稼働報告", icon: Timer },
    ],
  },
  {
    heading: "顧客",
    items: [
      { href: "/app/accounts", label: "顧客", icon: Building2 },
      { href: "/app/contacts", label: "担当者", icon: Users },
      { href: "/app/business-cards", label: "名刺情報", icon: Contact },
      { href: "/app/email/templates", label: "メール", icon: Mail },
      { href: "/app/leads", label: "リード", icon: Sparkles },
      { href: "/app/srank", label: "Sランク攻略", icon: Star },
      { href: "/app/nurture", label: "既存顧客深耕", icon: TrendingUp },
      { href: "/app/knowledge", label: "ノウハウ・事例", icon: Lightbulb },
      { href: "/app/playbooks", label: "カトルセの型", icon: Swords },
    ],
  },
  {
    heading: "分析・レビュー",
    items: [
      { href: "/app/pmo", label: "AI-PMO", icon: Telescope },
      { href: "/app/analytics/xray", label: "営業レントゲン", icon: ScanLine },
      { href: "/app/analytics", label: "分析ハブ", icon: Gauge },
      { href: "/app/analytics/winloss", label: "失注/成約分析", icon: Scale },
      { href: "/app/exec", label: "経営レビュー", icon: Presentation },
      { href: "/app/reviews/weekly", label: "週次レビュー", icon: CalendarCheck },
      { href: "/app/reviews/rep", label: "営業マン別週報", icon: NotebookPen },
      { href: "/app/reviews/yomi-history", label: "ヨミ変更履歴", icon: ArrowRightLeft },
      { href: "/app/reviews/snapshots", label: "週報スナップショット", icon: History },
      { href: "/app/content", label: "記事ネタ・ブログ", icon: PenLine },
      { href: "/app/exec/batch", label: "AIバッチ運用", icon: Bot },
      { href: "/app/automation", label: "ワークフロー自動化", icon: Workflow },
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
const boGroups: NavGroup[] = [
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
      { href: "/app/work", label: "稼働報告", icon: Timer },
    ],
  },
];
const hrGroup: NavGroup = {
  heading: "人事",
  items: [
    { href: "/app/hr/openings", label: "求人案件", icon: Briefcase },
    { href: "/app/hr/candidates", label: "候補者", icon: Users },
    { href: "/app/hr/talents", label: "タレント台帳・評価", icon: Star },
  ],
};

/** 管理職には「案件」グループに原価管理(デリバリー原価・粗利)と稼働承認を差し込む。 */
function injectProjects(base: NavGroup[], role: Role): NavGroup[] {
  if (!canManageProjects(role)) return base;
  return base.map((g) =>
    g.heading === "案件"
      ? {
          ...g,
          items: [
            ...g.items,
            { href: "/app/projects", label: "原価管理", icon: FolderKanban },
            { href: "/app/projects/approvals", label: "稼働承認", icon: BadgeCheck },
          ],
        }
      : g
  );
}

/** ロールに応じたナビ(営業⇔BOの相互不可視、管理者は全部)。 */
export function navGroupsFor(role: Role): NavGroup[] {
  const sales = injectProjects(groups, role);
  if (role === "back_office") return boGroups;
  if (role === "hr") return [...boGroups, hrGroup];
  if (role === "owner" || role === "admin") return [...sales, ...boGroups, hrGroup];
  return sales; // 営業系ロール(管理職は案件管理が入る)
}

/** BO/人事はバックオフィス専用ナビ(営業側の最近見た項目などは非表示)。 */
export function isBackOfficeOnly(role: Role): boolean {
  return role === "back_office" || role === "hr";
}
