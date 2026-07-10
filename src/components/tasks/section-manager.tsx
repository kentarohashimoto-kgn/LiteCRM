"use client";

import { useState, useTransition } from "react";
import { Plus, Check, X, Pencil } from "lucide-react";
import { createSectionAction, renameSectionAction, deleteSectionAction } from "@/server/actions/tasks";
import { cn } from "@/lib/utils";

interface SectionVM {
  id: string;
  name: string;
}

export function SectionManager({ projectId, sections }: { projectId: string; sections: SectionVM[] }) {
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = () => {
    const n = name.trim();
    if (n) start(() => createSectionAction(projectId, n));
    setName("");
    setAdding(false);
  };
  const rename = (id: string) => {
    const n = editName.trim();
    if (n) start(() => renameSectionAction(id, n));
    setEditId(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold text-ink/40">セクション</span>
      {sections.map((s) =>
        editId === s.id ? (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-white border border-teal-primary px-2 py-0.5">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(s.id);
                if (e.key === "Escape") setEditId(null);
              }}
              className="w-24 text-xs outline-none"
            />
            <button type="button" onClick={() => rename(s.id)} className="text-teal-deep">
              <Check size={13} />
            </button>
          </span>
        ) : (
          <span key={s.id} className="group inline-flex items-center gap-1 rounded-full bg-mist-soft px-2.5 py-0.5 text-xs text-ink/60">
            {s.name}
            <button
              type="button"
              onClick={() => {
                setEditId(s.id);
                setEditName(s.name);
              }}
              className="opacity-0 group-hover:opacity-100 text-ink/30 hover:text-teal-deep transition-opacity"
              title="名前を変更"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={() => start(() => deleteSectionAction(s.id))}
              className="opacity-0 group-hover:opacity-100 text-ink/30 hover:text-rose-500 transition-opacity"
              title="削除（タスクは未分類へ）"
            >
              <X size={12} />
            </button>
          </span>
        ),
      )}
      {adding ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-white border border-teal-primary px-2 py-0.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") setAdding(false);
            }}
            onBlur={add}
            placeholder="セクション名"
            className="w-24 text-xs outline-none"
          />
        </span>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={cn("inline-flex items-center gap-0.5 rounded-full border border-dashed border-black/15 px-2.5 py-0.5 text-xs text-ink/40 hover:text-teal-deep hover:border-teal-primary transition-colors")}>
          <Plus size={12} /> 追加
        </button>
      )}
    </div>
  );
}
