"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { updateCampaignNameAction } from "@/server/actions";

/** 展示会名などのインライン編集(クリックで入力→保存)。 */
export function EditableName({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!val.trim() || val.trim() === name) { setEditing(false); return; }
    setBusy(true);
    await updateCampaignNameAction(id, val.trim());
    router.refresh();
    setBusy(false);
    setEditing(false);
  }

  if (!editing) {
    return (
      <span className="group inline-flex items-center gap-1">
        <span className="font-medium text-ink">{name}</span>
        <button onClick={() => { setVal(name); setEditing(true); }} className="opacity-0 group-hover:opacity-100 text-ink/30 hover:text-teal-deep transition-opacity" title="名称を編集">
          <Pencil size={12} />
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        autoFocus
        className="rounded-md border border-teal-primary bg-white px-1.5 py-0.5 text-sm outline-none w-48"
      />
      <button onClick={save} disabled={busy} className="text-teal-deep hover:text-teal-primary disabled:opacity-40" title="保存"><Check size={14} /></button>
      <button onClick={() => setEditing(false)} className="text-ink/30 hover:text-rose-500" title="取消"><X size={14} /></button>
    </span>
  );
}
