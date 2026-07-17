"use client";

import { useEffect, useState, useTransition } from "react";
import { AtSign, Loader2, Send, Trash2 } from "lucide-react";
import { addTaskCommentAction, deleteTaskCommentAction, listTaskCommentsAction, type TaskCommentView } from "@/server/actions/comments";
import type { UserVM } from "./vm";

function fmt(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * F-203 タスクコメント（社内スレッド・@メンション）。
 * 詳細ドロワーで開いたときに遅延ロードする。案件コメント(C-2)と同じ操作感。
 * メンション相手＋タスク担当者へアプリ内ベル＋Slack通知（設定時）。
 */
export function TaskComments({
  taskId,
  members,
  currentUserId,
  isAdmin,
  onCountChange,
}: {
  taskId: string;
  members: UserVM[];
  currentUserId: string;
  isAdmin: boolean;
  onCountChange?: (taskId: string, count: number) => void;
}) {
  const [comments, setComments] = useState<TaskCommentView[] | null>(null);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  // 一時IDのタスク（楽観作成直後）にはコメントが無いので読み込まない
  const persisted = !taskId.startsWith("temp-");

  useEffect(() => {
    if (!persisted) {
      setComments([]);
      return;
    }
    let alive = true;
    setComments(null);
    listTaskCommentsAction(taskId).then((rows) => {
      if (alive) setComments(rows);
    });
    return () => {
      alive = false;
    };
  }, [taskId, persisted]);

  const toggleMention = (id: string) => setMentions((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = () => {
    if (!body.trim() || pending || !persisted) return;
    setError("");
    startTransition(async () => {
      const res = await addTaskCommentAction({ taskId, body, mentions });
      if (!res.ok) {
        setError(res.error ?? "投稿に失敗しました");
        return;
      }
      setBody("");
      setMentions([]);
      const rows = await listTaskCommentsAction(taskId);
      setComments(rows);
      onCountChange?.(taskId, rows.length);
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("このコメントを削除しますか？")) return;
    startTransition(async () => {
      await deleteTaskCommentAction({ id });
      const rows = await listTaskCommentsAction(taskId);
      setComments(rows);
      onCountChange?.(taskId, rows.length);
    });
  };

  return (
    <div className="space-y-3">
      {comments === null ? (
        <div className="flex items-center gap-1.5 py-2 text-xs text-ink/40">
          <Loader2 size={13} className="animate-spin" /> 読み込み中…
        </div>
      ) : comments.length === 0 ? (
        <p className="py-1 text-xs text-ink/40">コメントはまだありません。指示・引継ぎメモをここに残せます。</p>
      ) : (
        <ul className="space-y-2.5">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl bg-black/[0.02] px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-ink/45">
                <span className="font-medium text-ink/70">{c.authorName}</span>
                <span>{fmt(c.created_at)}</span>
                {c.mentions.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-teal-deep">
                    <AtSign size={10} />
                    {c.mentions.map((m) => nameOf.get(m) ?? "—").join(" ")}
                  </span>
                )}
                {(c.author_user_id === currentUserId || isAdmin) && (
                  <button type="button" onClick={() => remove(c.id)} className="ml-auto text-ink/30 hover:text-rose-500" aria-label="コメントを削除">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-[13px] text-ink/85">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {persisted && (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            className="input text-sm"
            placeholder="コメントを書く（⌘/Ctrl+Enterで投稿・下から通知先を選択）"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <AtSign size={12} className="text-ink/35" />
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMention(m.id)}
                className={`pill border text-[11px] ${mentions.includes(m.id) ? "bg-teal-light text-teal-deep border-teal-primary/40" : "bg-white text-ink/50 border-black/10 hover:bg-black/[0.03]"}`}
              >
                {m.name}
              </button>
            ))}
            <button type="button" onClick={submit} disabled={pending || !body.trim()} className="btn-accent ml-auto inline-flex items-center gap-1.5 disabled:opacity-50">
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 投稿
            </button>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
