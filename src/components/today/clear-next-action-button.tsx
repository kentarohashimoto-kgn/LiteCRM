"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { clearNextActionAction } from "@/server/actions/opportunities";

/**
 * 「今日のアポ・AC」画面から次回アクションを消込するボタン。
 * 追わないと決めた案件を、案件詳細を開かずにその場でリストから外すための動線。
 * 消込内容は活動履歴(社内メモ)に残るので、消した経緯は後から追える。
 */
export function ClearNextActionButton({
  opportunityId,
  updatedAt,
  nextActionDate,
}: {
  opportunityId: string;
  updatedAt: string;
  nextActionDate: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  async function onClick() {
    const when = nextActionDate ? `（${nextActionDate}）` : "";
    if (!window.confirm(`この案件の次回アクション${when}を消込します。\nリストから外れ、活動履歴に消込記録が残ります。よろしいですか？`)) return;
    const res = await clearNextActionAction({ id: opportunityId, updatedAt });
    if (!res.ok) {
      alert(res.error ?? "消込に失敗しました");
      if (res.conflict) router.refresh();
      return;
    }
    setDone(true);
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || done}
      className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-sm text-ink/60 hover:bg-black/[0.03] disabled:opacity-50"
    >
      <CheckCheck size={15} /> {done ? "消込しました" : "消込"}
    </button>
  );
}
