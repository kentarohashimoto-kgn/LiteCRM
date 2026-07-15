"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { updateCardTagsAction } from "@/server/actions/business-cards";

/**
 * 任意タグのチップ編集。既存タグは候補（datalist）として提示し、表記ゆれを防ぐ。
 */
export function CardTagsEditor({ cardId, tags, suggestions }: { cardId: string; tags: string[]; suggestions: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [input, setInput] = useState("");

  const save = (next: string[]) =>
    start(async () => {
      await updateCardTagsAction({ cardId, tags: next });
      router.refresh();
    });

  const add = () => {
    const v = input.trim();
    if (!v) return;
    setInput("");
    if (tags.includes(v)) return;
    save([...tags, v]);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent-orange/10 text-accent-orange border border-accent-orange/20 px-2 py-0.5 text-xs">
            {t}
            <button
              type="button"
              disabled={pending}
              onClick={() => save(tags.filter((x) => x !== t))}
              className="hover:text-rose-500"
              title="タグを外す"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-ink/40">タグなし</span>}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(); }
          }}
          list="card-user-tags"
          placeholder="タグを追加（例: 要フォロー / 展示会お礼済）"
          className="flex-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs"
        />
        <datalist id="card-user-tags">
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <button type="button" onClick={add} disabled={pending || !input.trim()} className="btn-ghost text-xs disabled:opacity-40">
          <Plus size={13} className="inline mr-0.5" />追加
        </button>
      </div>
    </div>
  );
}
