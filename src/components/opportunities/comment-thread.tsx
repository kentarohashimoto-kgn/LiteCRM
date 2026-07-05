"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Loader2, Send, Trash2 } from "lucide-react";
import { addOppCommentAction, deleteOppCommentAction } from "@/server/actions/comments";

export interface CommentView {
  id: string;
  author_user_id: string;
  authorName: string;
  body: string;
  mentions: string[];
  created_at: string;
}

interface Member { id: string; name: string; }

function fmt(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * C-2 案件コメント(社内スレッド)。メンバーをメンションするとSlackに通知される。
 */
export function CommentThread({
  opportunityId,
  comments,
  members,
  currentUserId,
  isAdmin,
}: {
  opportunityId: string;
  comments: CommentView[];
  members: Member[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  const toggleMention = (id: string) =>
    setMentions((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = () => {
    if (!body.trim() || pending) return;
    setError("");
    startTransition(async () => {
      const res = await addOppCommentAction({ opportunityId, body, mentions });
      if (!res.ok) {
        setError(res.error ?? "投稿に失敗しました");
        return;
      }
      setBody("");
      setMentions([]);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!window.confirm("このコメントを削除しますか？")) return;
    startTransition(async () => {
      await deleteOppCommentAction({ id, opportunityId });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-sm text-ink/40 py-2">コメントはまだありません。本部からの指示・引継ぎメモなどをここに残せます。</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl bg-black/[0.02] px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-xs text-ink/45">
                <span className="font-medium text-ink/70">{c.authorName}</span>
                <span>{fmt(c.created_at)}</span>
                {c.mentions.length > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-teal-deep">
                    <AtSign size={11} />
                    {c.mentions.map((m) => nameOf.get(m) ?? "—").join(" ")}
                  </span>
                )}
                {(c.author_user_id === currentUserId || isAdmin) && (
                  <button type="button" onClick={() => remove(c.id)} className="ml-auto text-ink/30 hover:text-rose-500" aria-label="コメントを削除">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <p className="text-sm text-ink/85 mt-1 whitespace-pre-line">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          className="input"
          placeholder="コメントを書く（@メンションで下から通知先を選択）"
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          <AtSign size={13} className="text-ink/35" />
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleMention(m.id)}
              className={`pill border ${mentions.includes(m.id) ? "bg-teal-light text-teal-deep border-teal-primary/40" : "bg-white text-ink/50 border-black/10 hover:bg-black/[0.03]"}`}
            >
              {m.name}
            </button>
          ))}
          <button
            type="button"
            onClick={submit}
            disabled={pending || !body.trim()}
            className="btn-accent ml-auto inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 投稿
          </button>
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <p className="text-[11px] text-ink/35">メンションを選ぶと Slack にも通知されます（Webhook設定時）。</p>
      </div>
    </div>
  );
}
