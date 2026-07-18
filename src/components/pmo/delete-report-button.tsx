"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deletePmoReportAction } from "@/server/actions/pmo";

/** レポート削除ボタン(owner/adminのみRLSで実際に削除できる)。 */
export function DeleteReportButton({ reportId, onDeleted }: { reportId: string; onDeleted?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () => {
    if (!confirm("このレポートを削除しますか？")) return;
    startTransition(async () => {
      const res = await deletePmoReportAction({ reportId });
      if (!res.ok) {
        alert(res.error ?? "削除に失敗しました");
        return;
      }
      onDeleted?.();
      router.refresh();
      if (!onDeleted) router.replace("/app/pmo");
    });
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="inline-flex items-center gap-1 text-xs text-ink/40 hover:text-rose-600 disabled:opacity-50"
      title="レポートを削除(管理者のみ)"
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      削除
    </button>
  );
}
