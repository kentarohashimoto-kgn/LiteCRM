"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { archiveLabConversation, renameLabConversation } from "@/server/actions/ai-lab-chat";
import type { LabUiConversation } from "@/lib/ai-lab/ui-types";
import { cn } from "@/lib/utils";
import { useLabChat } from "./lab-chat-context";

export function ConversationList({
  slug,
  onNavigate,
}: {
  slug: string;
  /** モバイルのドロワーを閉じるためのフック。 */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { conversations, activeId, startNewChat } = useLabChat();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function beginEdit(c: LabUiConversation) {
    setEditingId(c.id);
    setDraft(c.title);
  }

  function commitRename(id: string) {
    const title = draft.trim();
    setEditingId(null);
    if (!title) return;
    startTransition(async () => {
      await renameLabConversation({ slug, conversationId: id, title });
      router.refresh();
    });
  }

  function remove(c: LabUiConversation) {
    if (!window.confirm(`「${c.title}」を削除しますか？`)) return;
    startTransition(async () => {
      await archiveLabConversation({ slug, conversationId: c.id });
      // 開いている会話を消したときは新規チャットへ戻す。
      // URLだけ差し替えている場合ルーターの現在地がずれているため、画面の初期化も明示的に行う。
      if (activeId === c.id) {
        startNewChat();
        window.history.replaceState(null, "", `/lab/${slug}/chat`);
        router.push(`/lab/${slug}/chat`);
      }
      router.refresh();
    });
  }

  if (conversations.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-white/40">まだ会話がありません</p>;
  }

  return (
    <ul className={cn("space-y-0.5", pending && "opacity-60")}>
      {conversations.map((c) => {
        const active = c.id === activeId;
        return (
          <li key={c.id} className="group relative">
            {editingId === c.id ? (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/20"
                />
                <button type="button" onClick={() => commitRename(c.id)} className="p-1 text-white/70 hover:text-white" aria-label="保存">
                  <Check size={14} />
                </button>
                <button type="button" onClick={() => setEditingId(null)} className="p-1 text-white/70 hover:text-white" aria-label="やめる">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <Link
                  href={`/lab/${slug}/chat/${c.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2 pr-14 text-sm transition-colors",
                    active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <MessageSquare size={14} className="shrink-0 opacity-60" />
                  <span className="truncate">{c.title}</span>
                </Link>
                <div className="absolute right-1 top-1.5 hidden gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => beginEdit(c)}
                    className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                    aria-label="名前を変更"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-rose-300"
                    aria-label="削除"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
