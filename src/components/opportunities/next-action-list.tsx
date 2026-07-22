"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toggleTaskDoneAction, deleteTaskAction } from "@/server/actions/tasks";
import { addOpportunityNextActionAction } from "@/server/actions/next-actions";
import { formatDateFull } from "@/lib/utils";

export interface NextActionItem {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
  overdue: boolean;
  sourceMeetingId?: string | null;
  sourceMeetingTitle?: string | null;
}

/**
 * 案件のネクストアクション一覧（複数）。
 *  - 実体は tasks(origin='next_action')。商談発のものは source_meeting へリンク。
 *  - 完了トグル・削除・手動追加ができる。一覧/サマリには最も近い未完了が代表表示される。
 */
export function NextActionList({
  opportunityId,
  items,
}: {
  opportunityId: string;
  items: NextActionItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const toggle = (id: string, done: boolean) => {
    startTransition(async () => {
      await toggleTaskDoneAction(id, done);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("このネクストアクションを削除しますか？")) return;
    startTransition(async () => {
      await deleteTaskAction(id);
      router.refresh();
    });
  };

  const add = () => {
    if (!date || pending) return;
    setError("");
    startTransition(async () => {
      const res = await addOpportunityNextActionAction({ opportunityId, date, text });
      if (!res.ok) {
        setError(res.error ?? "追加に失敗しました");
        return;
      }
      setDate("");
      setText("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-ink/40 py-1">ネクストアクションはありません</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={it.done}
                onChange={(e) => toggle(it.id, e.target.checked)}
                disabled={pending}
                className="mt-1 h-4 w-4 shrink-0 accent-teal-deep cursor-pointer"
                aria-label="完了"
              />
              <div className="min-w-0 flex-1">
                <div className={it.done ? "line-through text-ink/40" : "text-ink/85"}>{it.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span className={!it.done && it.overdue ? "font-semibold text-rose-600" : "text-ink/45"}>
                    {formatDateFull(it.dueDate)}
                    {!it.done && it.overdue ? "・超過" : ""}
                  </span>
                  {it.sourceMeetingId ? (
                    <Link
                      href={`/app/opportunities/${opportunityId}/meetings/${it.sourceMeetingId}`}
                      className="pill bg-mist-soft/60 text-ink/55 hover:text-teal-deep"
                    >
                      商談: {it.sourceMeetingTitle ?? "—"}
                    </Link>
                  ) : (
                    <span className="pill bg-mist-soft/60 text-ink/45">手動</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(it.id)}
                disabled={pending}
                className="mt-0.5 text-ink/30 hover:text-rose-600"
                aria-label="削除"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-black/[0.05] pt-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">次アクション日</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className="label">次アクション内容</label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="input"
              placeholder="例：提案書を送付する"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); add(); }
              }}
            />
          </div>
          <button type="button" onClick={add} disabled={!date || pending} className="btn-primary whitespace-nowrap">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 追加
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
