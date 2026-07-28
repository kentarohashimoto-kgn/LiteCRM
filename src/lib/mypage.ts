/**
 * マイページ(個人カスタマイズホーム)のガジェット定義とレイアウト正規化。
 * レイアウトは user_home_layouts.layout(jsonb) に1ユーザー1行で保存する。
 * ガジェットはロールで利用可否を制御する(表示だけでなく保存時も除外し、
 * ロール変更後に不可視ガジェットが残らないようにする)。
 */
import type { Role } from "@/lib/types";
import { PROJECT_ROLES, SALES_NUMBER_ROLES, BO_ONLY_ROLES } from "@/lib/constants";
import { navGroupsFor } from "@/components/layout/nav-config";

export type GadgetKey = "shortcuts" | "calendar" | "tasks" | "projects" | "rep_weekly" | "pmo";
export type GadgetSize = "half" | "full";

export interface GadgetSetting {
  key: GadgetKey;
  size: GadgetSize;
}

export interface MypageLayout {
  gadgets: GadgetSetting[];
  /** ショートカットに並べる画面のhref(ロールで許可されたナビ項目のみ有効) */
  shortcuts: string[];
}

/** 営業領域を持つロール(BO専任以外)。カレンダー等の営業ガジェットの対象。 */
const SALES_AREA_ROLES: Role[] = [...SALES_NUMBER_ROLES, "inside_sales"];

export interface GadgetDef {
  key: GadgetKey;
  label: string;
  description: string;
  /** 利用できるロール。"all" は全ロール。 */
  roles: Role[] | "all";
  defaultSize: GadgetSize;
}

export const GADGETS: GadgetDef[] = [
  { key: "shortcuts", label: "ショートカット", description: "よく使う画面へのリンクを自由に配置", roles: "all", defaultSize: "full" },
  { key: "calendar", label: "案件カレンダー", description: "アポ・商談の月間カレンダー", roles: SALES_AREA_ROLES, defaultSize: "full" },
  { key: "tasks", label: "タスク(カンバン)", description: "自分のタスクを期限別カンバンで表示", roles: "all", defaultSize: "full" },
  { key: "projects", label: "原価管理 一覧", description: "進行中プロジェクトの売上・原価・粗利", roles: PROJECT_ROLES, defaultSize: "full" },
  { key: "rep_weekly", label: "営業マン別週報", description: "今週の目標・実績・見込みとパイプライン", roles: SALES_NUMBER_ROLES, defaultSize: "half" },
  { key: "pmo", label: "AI-PMO", description: "最新のAI-PMOレポートのサマリー", roles: SALES_NUMBER_ROLES, defaultSize: "half" },
];

export const GADGET_MAP = Object.fromEntries(GADGETS.map((g) => [g.key, g])) as Record<GadgetKey, GadgetDef>;

/** そのロールで利用できるガジェット定義。 */
export function gadgetsFor(role: Role): GadgetDef[] {
  return GADGETS.filter((g) => g.roles === "all" || g.roles.includes(role));
}

export interface ShortcutOption {
  href: string;
  label: string;
  group: string;
}

/**
 * ショートカットに選べる画面 = ロール別ナビに出る画面(重複hrefは先勝ち)。
 * ナビと同じ源泉を使うことで、ロールで見せない画面がショートカット経由で
 * 露出しないことを構造的に保証する。
 */
export function shortcutOptionsFor(role: Role): ShortcutOption[] {
  const seen = new Set<string>();
  const options: ShortcutOption[] = [];
  for (const group of navGroupsFor(role)) {
    for (const item of group.items) {
      if (item.href === "/app/mypage" || seen.has(item.href)) continue;
      seen.add(item.href);
      options.push({ href: item.href, label: item.label, group: group.heading });
    }
  }
  return options;
}

/** ロール別の初期レイアウト(未保存ユーザー・リセット時)。 */
export function defaultLayoutFor(role: Role): MypageLayout {
  if (role === "inside_sales") {
    return {
      gadgets: [{ key: "shortcuts", size: "full" }, { key: "calendar", size: "full" }, { key: "tasks", size: "full" }],
      shortcuts: ["/app/appointments/new", "/app/opportunities"],
    };
  }
  if (BO_ONLY_ROLES.includes(role)) {
    return {
      gadgets: [{ key: "shortcuts", size: "full" }, { key: "tasks", size: "full" }],
      shortcuts: role === "hr"
        ? ["/app/bo", "/app/bo/subsidies", "/app/hr/candidates", "/app/work"]
        : ["/app/bo", "/app/bo/subsidies", "/app/bo/followups", "/app/work"],
    };
  }
  if (role === "owner" || role === "admin" || role === "sales_manager") {
    return {
      gadgets: [
        { key: "shortcuts", size: "full" },
        { key: "calendar", size: "full" },
        { key: "tasks", size: "full" },
        { key: "rep_weekly", size: "half" },
        { key: "pmo", size: "half" },
        { key: "projects", size: "full" },
      ],
      shortcuts: ["/app/dashboard", "/app/appointments/new", "/app/opportunities", "/app/pmo", "/app/reviews/rep"],
    };
  }
  // 営業担当ほか営業系ロール
  return {
    gadgets: [
      { key: "shortcuts", size: "full" },
      { key: "calendar", size: "full" },
      { key: "tasks", size: "full" },
      { key: "rep_weekly", size: "half" },
    ],
    shortcuts: ["/app/dashboard", "/app/appointments/new", "/app/opportunities", "/app/today"],
  };
}

/**
 * 保存値(jsonb)をロールに合わせて正規化。未知キー・権限外ガジェット・
 * 権限外ショートカットを除去し、空なら初期レイアウトへフォールバック。
 */
export function normalizeLayout(raw: unknown, role: Role): MypageLayout {
  const allowedGadgets = new Set(gadgetsFor(role).map((g) => g.key));
  const allowedShortcuts = new Set(shortcutOptionsFor(role).map((o) => o.href));

  const obj = (raw ?? {}) as { gadgets?: unknown; shortcuts?: unknown };
  const seenKeys = new Set<string>();
  const gadgets: GadgetSetting[] = [];
  if (Array.isArray(obj.gadgets)) {
    for (const g of obj.gadgets) {
      const key = (g as { key?: unknown })?.key;
      const size = (g as { size?: unknown })?.size;
      if (typeof key !== "string" || seenKeys.has(key) || !allowedGadgets.has(key as GadgetKey)) continue;
      seenKeys.add(key);
      gadgets.push({ key: key as GadgetKey, size: size === "half" ? "half" : "full" });
    }
  }

  const shortcuts = Array.isArray(obj.shortcuts)
    ? (obj.shortcuts.filter((s) => typeof s === "string" && allowedShortcuts.has(s)) as string[]).slice(0, 24)
    : [];

  // 一度も保存していない(または全部権限外になった)場合は初期レイアウト
  if (gadgets.length === 0) return defaultLayoutFor(role);
  return { gadgets, shortcuts };
}
