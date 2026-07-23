"use client";

import { useState } from "react";
import { CalendarClock, Trash2, X } from "lucide-react";
import { rescheduleMeetingAction, deleteMeetingAction } from "@/server/actions";
import { SubmitButton } from "@/components/ui/submit-button";

const CONFIRM_DELETE = "この商談を削除します。よろしいですか？（元に戻せません）";

/** 商談リストの各行に付く操作: 日付変更(リスケ)と削除。 */
export function MeetingRowActions({
  meetingId,
  opportunityId,
  meetingDate,
  meetingTime,
  canDelete,
}: {
  meetingId: string;
  opportunityId: string;
  meetingDate: string;
  meetingTime: string;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[76px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-ink/50 hover:text-teal-deep"
      >
        {open ? <X size={12} /> : <CalendarClock size={12} />} 日付変更
      </button>
      {canDelete && (
        <form
          action={deleteMeetingAction}
          onSubmit={(e) => {
            if (!confirm(CONFIRM_DELETE)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={meetingId} />
          <input type="hidden" name="opportunity_id" value={opportunityId} />
          <button type="submit" className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-500/80 hover:text-rose-600">
            <Trash2 size={12} /> 削除
          </button>
        </form>
      )}
      {open && (
        <form action={rescheduleMeetingAction} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="id" value={meetingId} />
          <input type="hidden" name="opportunity_id" value={opportunityId} />
          <input name="meeting_date" type="date" defaultValue={meetingDate} required className="input h-8 w-[140px] py-1 text-xs" />
          <input name="meeting_time" type="time" defaultValue={meetingTime} className="input h-8 w-[96px] py-1 text-xs" />
          <SubmitButton className="btn-primary px-2.5 py-1 text-xs" pendingLabel="更新中…">更新</SubmitButton>
        </form>
      )}
    </div>
  );
}

/** 商談詳細ページ用の削除ボタン。 */
export function DeleteMeetingButton({ meetingId, opportunityId }: { meetingId: string; opportunityId: string }) {
  return (
    <form
      action={deleteMeetingAction}
      onSubmit={(e) => {
        if (!confirm(CONFIRM_DELETE)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={meetingId} />
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100"
      >
        <Trash2 size={14} /> この商談を削除
      </button>
    </form>
  );
}
