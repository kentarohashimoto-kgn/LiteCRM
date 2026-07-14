"use client";

import { useRef } from "react";
import { setMilestoneCompletionAction, deleteSubsidyMilestoneAction } from "@/server/actions/bo";

interface Milestone {
  id: string;
  kind: string;
  label: string;
  due_date: string;
  status: string;
  completed_at: string | null;
}

/**
 * 助成金マイルストーン1行。完了はチェックではなく「完了日」を入れて管理する。
 * 日付を入れると完了・空にすると未完了に戻る（入力するとその場で保存）。
 */
export function MilestoneRow({ m, today }: { m: Milestone; today: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const done = m.status === "done";
  const isOverdue = !done && m.due_date < today;

  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className={done ? "line-through text-ink/40" : "text-ink/80"}>{m.label}</span>
      {m.kind === "custom" && <span className="pill bg-black/[0.04] text-ink/40 text-[10px]">追加</span>}

      <span className={`text-xs tabular-nums ml-auto shrink-0 ${isOverdue ? "text-rose-600 font-semibold" : "text-ink/45"}`}>
        期日 {m.due_date}
        {isOverdue && " 超過"}
      </span>

      <form action={setMilestoneCompletionAction} ref={formRef} className="flex items-center gap-1 shrink-0">
        <input type="hidden" name="id" value={m.id} />
        <span className="text-[11px] text-ink/40">完了日</span>
        <input
          type="date"
          name="completed_at"
          defaultValue={m.completed_at ?? ""}
          onChange={() => formRef.current?.requestSubmit()}
          className={`rounded border px-1.5 py-1 text-xs w-[136px] ${done ? "border-teal-primary/40 bg-teal-light/30 text-teal-deep" : "border-black/15 bg-white"}`}
          title="完了日を入れると完了になります（空にすると未完了に戻ります）"
        />
      </form>

      {m.kind === "custom" && (
        <form action={deleteSubsidyMilestoneAction} className="shrink-0">
          <input type="hidden" name="id" value={m.id} />
          <button className="text-xs text-rose-400 hover:underline" title="この追加項目を削除">削除</button>
        </form>
      )}
    </li>
  );
}
