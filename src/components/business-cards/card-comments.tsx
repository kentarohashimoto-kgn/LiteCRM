"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { addCardCommentAction, deleteCardCommentAction } from "@/server/actions/business-cards";
import type { BusinessCardComment } from "@/lib/types";

function fmt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 名刺のコメントスレッド（投稿・削除）。削除は本人 or owner/admin（RLSで担保）。 */
export function CardComments({
  cardId,
  comments,
  nameById,
  currentUserId,
  canModerate,
}: {
  cardId: string;
  comments: BusinessCardComment[];
  nameById: Record<string, string>;
  currentUserId: string;
  canModerate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const post = () =>
    start(async () => {
      setError(null);
      const r = await addCardCommentAction({ cardId, body });
      if (!r.ok) { setError(r.error ?? "投稿に失敗しました"); return; }
      setBody("");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="この名刺についてのコメント（例: 展示会でAI研修に興味。来週電話する）"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={post} disabled={pending || !body.trim()} className="btn-primary text-sm disabled:opacity-40">
            <MessageSquarePlus size={14} className="mr-1 inline" />投稿
          </button>
          {error && <span className="text-sm text-rose-600">{error}</span>}
        </div>
      </div>

      {comments.length === 0 ? (
        <p className="text-sm text-ink/40">コメントはまだありません</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-mist-soft/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-ink/50">
                  <span className="font-medium text-ink/70">{nameById[c.author_user_id] ?? "—"}</span>
                  <span className="ml-2">{fmt(c.created_at)}</span>
                </div>
                {(c.author_user_id === currentUserId || canModerate) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => start(async () => { await deleteCardCommentAction({ commentId: c.id, cardId }); router.refresh(); })}
                    className="text-ink/30 hover:text-rose-500"
                    title="コメントを削除"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="mt-1 text-sm whitespace-pre-wrap">{c.body}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
