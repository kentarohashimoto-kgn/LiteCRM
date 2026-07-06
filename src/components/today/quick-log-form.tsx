"use client";

import { useState } from "react";
import { PencilLine } from "lucide-react";
import { ACTIVITY_TYPES } from "@/lib/constants";
import { addActivityAction } from "@/server/actions";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * A-7: その場で活動登録する折りたたみフォーム(スマホ親指操作を想定)。
 * 送信は既存の addActivityAction(次回ACも同時更新)。
 */
export function QuickLogForm({ opportunityId, accountId }: { opportunityId: string; accountId: string | null }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-teal-primary/30 bg-teal-light/50 py-2 text-sm font-medium text-teal-deep"
      >
        <PencilLine size={15} /> 活動を記録する
      </button>
    );
  }

  return (
    <form action={addActivityAction} className="mt-3 space-y-2.5 rounded-xl bg-black/[0.02] p-3">
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      {accountId && <input type="hidden" name="account_id" value={accountId} />}
      <input type="hidden" name="redirect_to" value="/app/today" />
      <div className="grid grid-cols-2 gap-2.5">
        <select name="activity_type" defaultValue="meeting" className="input">
          {ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <input name="title" required className="input" placeholder="例：商談実施" />
      </div>
      <textarea name="body" rows={3} className="input" placeholder="反応・課題・決まったことをメモ" />
      <div className="grid grid-cols-2 gap-2.5">
        <input name="next_action_date" type="date" className="input" aria-label="次アクション日" />
        <input name="next_action_text" className="input" placeholder="次アクション内容" />
      </div>
      <div className="flex gap-2">
        <SubmitButton className="btn-accent flex-1" pendingLabel="記録中…">記録する</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-black/10 px-4 text-sm text-ink/60">閉じる</button>
      </div>
    </form>
  );
}
