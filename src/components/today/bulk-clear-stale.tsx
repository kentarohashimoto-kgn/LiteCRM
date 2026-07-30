"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eraser } from "lucide-react";
import { listStaleNextActionsAction, bulkClearNextActionsAction } from "@/server/actions/opportunities";

/** 棚卸しのしきい値。既定は90日（四半期をまたいで放置されたAC）。 */
const DAY_OPTIONS = [30, 60, 90, 180, 365];

/**
 * 「◯日以上超過した次回ACをまとめて消込」する棚卸しボタン。
 *
 * 画面の「期限超過」は先頭30件しか出ないので、これは表示分ではなくDB側の
 * 対象全件（1回あたり最大200件）を相手にする。押した直後には消さず、
 * まず対象件数を出してから確認する2段階。
 */
export function BulkClearStale({ teamWide }: { teamWide: boolean }) {
  const router = useRouter();
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    if (busy) return;
    setBusy(true);
    const scope = teamWide ? "チーム全体" : "自分の担当";
    const preview = await listStaleNextActionsAction({ olderThanDays: days, teamWide });
    if (!preview.ok) {
      setBusy(false);
      alert(preview.error ?? "対象の取得に失敗しました");
      return;
    }
    if (preview.ids.length === 0) {
      setBusy(false);
      alert(`${scope}に、${days}日以上超過した次回ACはありません。`);
      return;
    }
    const rest = preview.total > preview.ids.length ? `\n（対象は全${preview.total}件。残りはもう一度実行してください）` : "";
    const ok = window.confirm(
      `${scope}の「${days}日以上超過した次回AC」${preview.ids.length}件を消込します。${rest}\n\n` +
        `各案件の次回アクション日・内容が空になり、活動履歴に消込記録が残ります。よろしいですか？`,
    );
    if (!ok) {
      setBusy(false);
      return;
    }
    const res = await bulkClearNextActionsAction({ ids: preview.ids });
    setBusy(false);
    if (!res.ok) {
      alert(res.error ?? "一括消込に失敗しました");
      return;
    }
    alert(`${res.cleared}件を消込しました。`);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        disabled={busy}
        aria-label="一括消込の対象（超過日数）"
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-teal-primary"
      >
        {DAY_OPTIONS.map((d) => (
          <option key={d} value={d}>{d}日以上</option>
        ))}
      </select>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1 text-xs text-ink/60 hover:bg-black/[0.03] disabled:opacity-50"
      >
        <Eraser size={14} /> {busy ? "処理中…" : "まとめて消込"}
      </button>
    </div>
  );
}
