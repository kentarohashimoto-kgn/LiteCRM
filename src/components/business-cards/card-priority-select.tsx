"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCardPriorityAction } from "@/server/actions/business-cards";

export const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  high: { label: "高", cls: "bg-rose-50 text-rose-600 border-rose-200" },
  medium: { label: "中", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  low: { label: "低", cls: "bg-sky-50 text-sky-700 border-sky-200" },
};

/**
 * アクション優先度のインライン選択。一覧の行・詳細ページ共用。
 * 「あとでアクションする名刺」をその場でマークアップできる。
 */
export function CardPrioritySelect({ cardId, priority }: { cardId: string; priority: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cur = priority && PRIORITY_META[priority] ? priority : "";

  return (
    <select
      value={cur}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          const v = e.target.value;
          await setCardPriorityAction({ cardId, priority: v === "" ? null : (v as "high" | "medium" | "low") });
          router.refresh();
        })
      }
      className={`rounded-lg border px-1.5 py-0.5 text-xs cursor-pointer disabled:opacity-50 ${cur ? PRIORITY_META[cur].cls : "border-black/10 text-ink/40 bg-white"}`}
      title="アクション優先度"
    >
      <option value="">—</option>
      <option value="high">高</option>
      <option value="medium">中</option>
      <option value="low">低</option>
    </select>
  );
}
