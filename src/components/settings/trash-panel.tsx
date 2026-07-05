"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Trash2, Loader2 } from "lucide-react";
import { restoreTrashAction, purgeTrashAction, type TrashData, type TrashKind, type TrashRow } from "@/server/actions/trash";

const KIND_META: { kind: TrashKind; key: keyof TrashData; label: string }[] = [
  { kind: "opportunity", key: "opportunities", label: "案件" },
  { kind: "account", key: "accounts", label: "顧客" },
  { kind: "lead", key: "leads", label: "リード" },
];

function fmt(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function daysLeft(deletedAt: string): number {
  const purgeAt = new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function TrashPanel({ initial, canPurge }: { initial: TrashData; canPurge: boolean }) {
  const [data, setData] = useState<TrashData>(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState("");

  const run = (kind: TrashKind, key: keyof TrashData, row: TrashRow, action: "restore" | "purge") => {
    if (action === "purge" && !window.confirm(`「${row.title}」を完全に削除します。この操作は取り消せません。よろしいですか？`)) return;
    setBusyId(row.id);
    setError("");
    startTransition(async () => {
      const res = action === "restore"
        ? await restoreTrashAction({ kind, id: row.id })
        : await purgeTrashAction({ kind, id: row.id });
      if (!res.ok) {
        setError(res.error ?? "操作に失敗しました");
      } else {
        setData((prev) => ({ ...prev, [key]: prev[key].filter((r) => r.id !== row.id) }));
      }
      setBusyId("");
    });
  };

  const empty = KIND_META.every((m) => data[m.key].length === 0);

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-rose-50 text-rose-600 text-sm px-4 py-2.5">{error}</div>}
      {empty && <p className="text-sm text-ink/40 py-8 text-center">ゴミ箱は空です</p>}
      {KIND_META.map(({ kind, key, label }) => {
        const rows = data[key];
        if (rows.length === 0) return null;
        return (
          <div key={kind} className="card card-pad">
            <h2 className="section-title mb-3">{label} <span className="text-xs font-normal text-ink/40">{rows.length}件</span></h2>
            <ul className="divide-y divide-black/[0.04]">
              {rows.map((row) => (
                <li key={row.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">{row.title}</div>
                    <div className="text-xs text-ink/40 truncate">
                      {row.sub ? `${row.sub} ・ ` : ""}
                      {fmt(row.deleted_at)} に {row.deleted_by_name} が削除 ・ あと{daysLeft(row.deleted_at)}日で自動削除
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pending && busyId === row.id}
                    onClick={() => run(kind, key, row, "restore")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03] shrink-0"
                  >
                    {pending && busyId === row.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} 復元
                  </button>
                  {canPurge && (
                    <button
                      type="button"
                      disabled={pending && busyId === row.id}
                      onClick={() => run(kind, key, row, "purge")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 px-3 py-1.5 text-sm hover:bg-rose-100 shrink-0"
                    >
                      <Trash2 size={14} /> 完全削除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
