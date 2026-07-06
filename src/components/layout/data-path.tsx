import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * データ階層の可視化。
 * リード → 顧客 → 案件 → 商談 → 活動履歴 の階層を、エンティティごとの固定色で示す。
 * - DataPath: 詳細ページ上部のパンくず(いまどのデータを見ているか)
 * - EditTarget: フォーム横の「更新対象」チップ(どのデータを更新しようとしているか)
 * 色はアプリ全体で共通: リード=紫 / 顧客=青 / 案件=ティール / 商談=オレンジ / 活動履歴=グリーン
 */

export type EntityLevel = "lead" | "account" | "opportunity" | "meeting" | "activity";

export const ENTITY_DEF: Record<EntityLevel, { label: string; chip: string; chipActive: string; dot: string; border: string }> = {
  lead: {
    label: "リード",
    chip: "bg-violet-50 text-violet-600 border-violet-200",
    chipActive: "bg-violet-600 text-white border-violet-600",
    dot: "bg-violet-500",
    border: "border-l-violet-400",
  },
  account: {
    label: "顧客",
    chip: "bg-blue-50 text-blue-600 border-blue-200",
    chipActive: "bg-blue-600 text-white border-blue-600",
    dot: "bg-blue-500",
    border: "border-l-blue-400",
  },
  opportunity: {
    label: "案件",
    // プロジェクトのteal定義(DEFAULT/primary/deep/light)を使用(標準のteal-50等は未定義)
    chip: "bg-teal-light text-teal-deep border-teal-primary/30",
    chipActive: "bg-teal-deep text-white border-teal-deep",
    dot: "bg-teal-primary",
    border: "border-l-teal-primary",
  },
  meeting: {
    label: "商談",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    chipActive: "bg-amber-500 text-white border-amber-500",
    dot: "bg-amber-500",
    border: "border-l-amber-400",
  },
  activity: {
    label: "活動履歴",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    chipActive: "bg-emerald-600 text-white border-emerald-600",
    dot: "bg-emerald-500",
    border: "border-l-emerald-400",
  },
};

export interface PathItem {
  level: EntityLevel;
  /** 表示名(会社名・案件名など)。省略時はエンティティ名のみ。 */
  name?: string;
  href?: string;
  /** いま開いているデータ(強調表示) */
  current?: boolean;
}

/** 詳細ページ上部のデータ階層パンくず。 */
export function DataPath({ items, className }: { items: PathItem[]; className?: string }) {
  return (
    <nav aria-label="データ階層" className={cn("flex items-center gap-1 flex-wrap mb-3", className)}>
      {items.map((it, i) => {
        const def = ENTITY_DEF[it.level];
        const body = (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs max-w-[260px]",
              it.current ? cn(def.chipActive, "font-semibold shadow-sm") : def.chip,
              it.href && !it.current && "hover:opacity-80",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", it.current ? "bg-white" : def.dot)} />
            <span className="shrink-0">{def.label}</span>
            {it.name && <span className={cn("truncate", it.current ? "text-white/90" : "opacity-70")}>{it.name}</span>}
            {it.current && <span className="shrink-0 text-[9px] rounded bg-white/25 px-1">いまここ</span>}
          </span>
        );
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="text-ink/25 shrink-0" />}
            {it.href && !it.current ? <Link href={it.href}>{body}</Link> : body}
          </span>
        );
      })}
    </nav>
  );
}

/** フォームの「更新対象」チップ。Sectionのaction等に置き、どのデータを更新するかを明示する。 */
export function EditTarget({ level }: { level: EntityLevel }) {
  const def = ENTITY_DEF[level];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium", def.chip)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", def.dot)} />
      更新対象: {def.label}
    </span>
  );
}

/** 編集フォームを囲むSectionに付けるエンティティ色の左ボーダー。 */
export function entityBorder(level: EntityLevel): string {
  return cn("border-l-4", ENTITY_DEF[level].border);
}
