"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Send, Trash2, Loader2 } from "lucide-react";
import { addOppCommentAction, deleteOppCommentAction, addLeadCommentAction, deleteLeadCommentAction } from "@/server/actions/comments";
import { cn } from "@/lib/utils";

export interface CommentVM {
  id: string;
  author_user_id: string;
  authorName: string;
  body: string;
  created_at: string;
}

function fmt(v: string): string {
  const d = new Date(v);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 展示会ドリルダウンの行内コメント。案件(opp)・リード(lead)共通。
 * 「💬 件数」で開閉し、その場で進捗コメントを追記できる。
 */
export function RowComments({
  kind,
  entityId,
  comments,
  currentUserId,
}: {
  kind: "opp" | "lead";
  entityId: string;
  comments: CommentVM[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    start(async () => {
      if (kind === "opp") await addOppCommentAction({ opportunityId: entityId, body: text, mentions: [] });
      else await addLeadCommentAction({ leadId: entityId, body: text });
      setBody("");
      router.refresh();
    });
  };

  const del = (id: string) => {
    start(async () => {
      if (kind === "opp") await deleteOppCommentAction({ id, opportunityId: entityId });
      else await deleteLeadCommentAction({ id });
      router.refresh();
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors",
          comments.length ? "text-teal-deep hover:bg-teal-light" : "text-ink/40 hover:bg-mist-soft",
        )}
        title="コメント"
      >
        <MessageSquare size={13} />
        {comments.length > 0 ? comments.length : ""}
      </button>

      {open && (
        <div className="mt-1.5 w-72 rounded-xl border border-black/10 bg-white p-2.5 shadow-sm">
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {comments.length === 0 && <p className="text-[11px] text-ink/35 py-1">まだコメントはありません</p>}
            {comments.map((c) => (
              <div key={c.id} className="group text-[12px]">
                <div className="flex items-center gap-1.5 text-[10px] text-ink/40">
                  <span className="font-semibold text-ink/60">{c.authorName}</span>
                  <span>{fmt(c.created_at)}</span>
                  {c.author_user_id === currentUserId && (
                    <button type="button" onClick={() => del(c.id)} className="ml-auto opacity-0 group-hover:opacity-100 text-ink/30 hover:text-rose-500">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                <div className="whitespace-pre-wrap text-ink/80">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-end gap-1.5">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              rows={2}
              placeholder="進捗・アプローチ状況を追記（⌘/Ctrl+Enterで投稿）"
              className="flex-1 resize-none rounded-lg border border-black/10 px-2 py-1 text-[12px] outline-none focus:border-teal-primary"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending || !body.trim()}
              className="rounded-lg bg-teal-primary p-1.5 text-white disabled:opacity-40"
              title="投稿"
            >
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
