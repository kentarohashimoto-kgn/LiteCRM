"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquarePlus, Send, Trash2 } from "lucide-react";
import { formatDateFull } from "@/lib/utils";
import { addPmoCommentAction, deletePmoCommentAction } from "@/server/actions/pmo";

export type PmoCommentLite = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  canDelete: boolean;
};

/**
 * レポートへのカトルセ(社内)コメント。追加したコメントは次回の夜間バッチ生成時に
 * AIへフィードバックされる(人間→AIのループ)。
 */
export function PmoReportComments({ reportId, comments }: { reportId: string; comments: PmoCommentLite[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const add = () => {
    setError("");
    startTransition(async () => {
      const res = await addPmoCommentAction({ reportId, body });
      if (!res.ok) {
        setError(res.error ?? "失敗しました");
        return;
      }
      setBody("");
      router.refresh();
    });
  };

  const remove = (commentId: string) => {
    startTransition(async () => {
      const res = await deletePmoCommentAction({ commentId });
      if (!res.ok) {
        setError(res.error ?? "削除に失敗しました");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mt-6 border-t border-black/[0.06] pt-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink/70 mb-2">
        <MessageSquarePlus size={15} className="text-teal-deep" />
        カトルセのコメント（次回の夜間分析にフィードバックされます）
      </div>

      {comments.length > 0 && (
        <ul className="space-y-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-black/[0.02] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink/45">
                  {c.authorName} ・ {formatDateFull(c.createdAt)}
                </span>
                {c.canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={pending}
                    className="text-ink/30 hover:text-rose-600 disabled:opacity-50"
                    title="コメントを削除"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <p className="text-sm text-ink/80 whitespace-pre-wrap mt-0.5">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
          rows={2}
          placeholder="例: 展示会は刈り取り優先で。BTは9月まで様子見。○○案件を重点的に見てほしい 等"
          className="flex-1 rounded-xl border border-black/[0.08] px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-1 focus:ring-teal-primary/40"
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || !body.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teal-deep text-white px-3 py-2 text-sm font-semibold hover:bg-teal-deep/90 disabled:opacity-50 shrink-0"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          追加
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
