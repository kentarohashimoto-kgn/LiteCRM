"use client";

import { useState } from "react";
import { updateMindmapMetaAction } from "@/server/actions/mindmaps";

/** マップ名のインライン編集(フォーカスを外したら保存)。 */
export function MindmapTitle({ mindmapId, initialTitle }: { mindmapId: string; initialTitle: string }) {
  const [title, setTitle] = useState(initialTitle);
  const [saved, setSaved] = useState(initialTitle);

  const save = async () => {
    const next = title.trim() || "無題";
    setTitle(next);
    if (next === saved) return;
    const res = await updateMindmapMetaAction({ mindmapId, title: next });
    if (res.ok) setSaved(next);
  };

  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      aria-label="マップ名"
      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-bold text-ink outline-none hover:border-black/10 focus:border-teal-primary focus:bg-white md:text-xl"
    />
  );
}
