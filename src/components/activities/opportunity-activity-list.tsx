"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_MAP } from "@/lib/constants";
import { updateActivityAction, deleteActivityAction } from "@/server/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { ENTITY_DEF } from "@/components/layout/data-path";

export interface ActivityItem {
  id: string;
  activity_type: string;
  title: string;
  body: string | null;
  activity_at: string;
  next_action_date: string | null;
  next_action_text: string | null;
  who: string | null;
}

function fmt(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * 案件配下の活動履歴を、編集・削除できる形で一覧表示する。
 * 誤登録の取り消し(削除)と内容修正(編集)に対応。
 */
export function OpportunityActivityList({ opportunityId, activities }: { opportunityId: string; activities: ActivityItem[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const dot = ENTITY_DEF.activity.dot;

  if (activities.length === 0) {
    return <p className="text-sm text-ink/40 py-3 text-center">この案件の活動記録はまだありません。上の「活動を記録」から追加できます。</p>;
  }

  return (
    <ul className="space-y-2">
      {activities.map((a) => {
        const isEditing = editing === a.id;
        if (isEditing) {
          return (
            <li key={a.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
              <form action={updateActivityAction} className="space-y-2.5">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="opportunity_id" value={opportunityId} />
                <div className="grid grid-cols-3 gap-2.5">
                  <select name="activity_type" defaultValue={a.activity_type} className="input">
                    {ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <input name="title" required defaultValue={a.title} className="input col-span-2" />
                </div>
                <textarea name="body" rows={3} defaultValue={a.body ?? ""} className="input" />
                <div className="grid grid-cols-2 gap-2.5">
                  <input name="next_action_date" type="date" defaultValue={a.next_action_date ?? ""} className="input" aria-label="次アクション日" />
                  <input name="next_action_text" defaultValue={a.next_action_text ?? ""} className="input" placeholder="次アクション内容" />
                </div>
                <div className="flex gap-2">
                  <SubmitButton className="btn-accent" pendingLabel="保存中…">保存</SubmitButton>
                  <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-black/10 px-4 text-sm text-ink/60">キャンセル</button>
                </div>
              </form>
            </li>
          );
        }
        return (
          <li key={a.id} className="group rounded-xl border border-black/[0.05] p-3">
            <div className="flex items-start gap-2.5">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="pill bg-emerald-50 text-emerald-700 text-[10px]">{ACTIVITY_TYPE_MAP[a.activity_type]?.label ?? a.activity_type}</span>
                  <span className="text-sm font-medium text-ink">{a.title}</span>
                  <span className="text-[11px] text-ink/40 tabular-nums">{fmt(a.activity_at)}{a.who ? `・${a.who}` : ""}</span>
                </div>
                {a.body && <p className="text-xs text-ink/65 mt-1 whitespace-pre-wrap line-clamp-4">{a.body}</p>}
                {a.next_action_date && <p className="text-[11px] text-ink/45 mt-1">次アクション: {a.next_action_date}{a.next_action_text ? `・${a.next_action_text}` : ""}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setEditing(a.id)} className="rounded-lg p-1.5 text-ink/40 hover:bg-black/[0.04] hover:text-ink" title="編集" aria-label="編集">
                  <Pencil size={14} />
                </button>
                <form action={deleteActivityAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="opportunity_id" value={opportunityId} />
                  <button
                    type="submit"
                    className="rounded-lg p-1.5 text-ink/40 hover:bg-rose-50 hover:text-rose-500"
                    title="削除"
                    aria-label="削除"
                  >
                    <Trash2 size={14} />
                  </button>
                </form>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
