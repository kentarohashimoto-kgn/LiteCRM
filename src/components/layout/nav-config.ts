import {
  Home,
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
  Lightbulb,
  NotebookPen,
  Timer,
  Workflow,
  Mail,
  Telescope,
  Brain,
  HelpCircle,
  Search,
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

// IA再編(docs/IA_MENU_REORG_PLAN_2026-07.md STEP 1):
// メニューから外した画面は削除していない。各ハブ/親ページのリンクから到達できる。
//   商談チェック→案件一覧ヘッダ / 失注・成約分析→分析ハブ / ヨミ変更履歴・週報スナップショット→週次レビュー・週報
//   Sランク攻略・既存顧客深耕→顧客一覧ヘッダ / カトルセの型・記事ネタ→ノウハウ・事例
const groups: NavGroup[] = [
  {
    heading: "ホーム",
    items: [
      { href: "/app/mypage", label: "マイページ", icon: Home },
      { href: "/app/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
      { href: "/app/today", label: "今日のアポ・AC", icon: Sun },
      { href: "/app/review", label: "AI確認キュー", icon: Inbox },
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
      { href: "/app/knowledge", label: "ノウハウ・事例", icon: Lightbulb },
      { href: "/app/assistant", label: "AIヘルプ", icon: Bot },
    ],
  },
  {
    heading: "分析",
    items: [
      { href: "/app/seo", label: "SEO集客", icon: Search },
      { href: "/app/seo/keywords", label: "KW順位表", icon: Target },
      { href: "/app/seo/plans", label: "記事プラン", icon: NotebookPen },
      { href: "/app/pmo", label: "AI-PMO", icon: Telescope },
      { href: "/app/analytics/xray", label: "営業レントゲン", icon: ScanLine },
      { href: "/app/analytics", label: "分析ハブ", icon: Gauge },
      { href: "/app/exec", label: "経営レビュー", icon: Presentation },
    ],
  },
  {
    heading: "レビュー",
    items: [
      { href: "/app/reviews/weekly", label: "週次レビュー", icon: CalendarCheck },
      { href: "/app/reviews/rep", label: "営業マン別週報", icon: NotebookPen },
    ],
  },
  {
    heading: "設定",
    items: [
      { href: "/app/help", label: "ヘルプ・マニュアル", icon: HelpCircle },
      { href: "/app/settings", label: "設定", icon: Settings },
      { href: "/app/opportunities/import", label: "データ取込", icon: ClipboardList },
      { href: "/app/exec/batch", label: "AIバッチ運用", icon: Bot },
      { href: "/app/automation", label: "ワークフロー自動化", icon: Workflow },
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

/** 管理者(代表/管理者)だけの機能を「ホーム」グループに差し込む。RLSでもDB側で遮断済み。 */
function injectAdminOnly(base: NavGroup[], role: Role): NavGroup[] {
  if (role !== "owner" && role !== "admin") return base;
  return base.map((g) =>
    g.heading === "ホーム"
      ? { ...g, items: [...g.items, { href: "/app/mindmaps", label: "マインドマップ", icon: Brain }] }
      : g,
  );
}

/** ヘルプはロールを問わず必要なため、BO専任ロールにも独立グループで差し込む。 */
const helpGroup: NavGroup = {
  heading: "ヘルプ",
  items: [{ href: "/app/help", label: "ヘルプ・マニュアル", icon: HelpCircle }],
};

// インサイドセールス: アポ・商談登録と登録後の確認(案件一覧)のみ。
// 営業数字(ダッシュボード・分析・予測等)は不可視(ページゲート＋DB側 can_view_sales_numbers で遮断)。
const insideSalesGroups: NavGroup[] = [
  {
    heading: "ホーム",
    items: [
      { href: "/app/mypage", label: "マイページ", icon: Home },
      { href: "/app/appointments/new", label: "アポ・商談登録", icon: CalendarCheck },
      { href: "/app/opportunities", label: "案件（表・ボード）", icon: Target },
      { href: "/app/tasks", label: "タスク", icon: CheckSquare },
    ],
  },
];

/** ロールに応じたナビ(営業⇔BOの相互不可視、管理者は全部)。ヘルプは全ロール共通。 */
export function navGroupsFor(role: Role): NavGroup[] {
  const sales = injectAdminOnly(injectProjects(groups, role), role); // 「設定」グループにヘルプを内包
  if (role === "inside_sales") return [...insideSalesGroups, helpGroup];
  if (role === "back_office") return [...boGroups, helpGroup];
  if (role === "hr") return [...boGroups, hrGroup, helpGroup];
  if (role === "owner" || role === "admin") return [...sales, ...boGroups, hrGroup];
  return sales; // 営業系ロール(管理職は案件管理が入る)
}

/** BO/人事はバックオフィス専用ナビ(営業側の最近見た項目などは非表示)。 */
export function isBackOfficeOnly(role: Role): boolean {
  return role === "back_office" || role === "hr";
}
