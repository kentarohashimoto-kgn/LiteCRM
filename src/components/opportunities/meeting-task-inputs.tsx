"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

interface Row { key: number; title: string; due: string }

const PRESETS = ["資料送付", "アポ調整", "提案書作成", "見積提出", "議事録送付"];

/**
 * 商談登録時に任意で登録するフォロータスクの入力。
 * プリセット(資料送付・アポ調整・提案書作成 等)のワンタップ追加と、自由入力の複数行に対応。
 * フィールド名は task_title[] / task_due[] として送信し、サーバ側でまとめてタスク化する。
 */
export function MeetingTaskInputs({ defaultDue = "" }: { defaultDue?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [seq, setSeq] = useState(1);

  const add = (title = "") => { setRows((rs) => [...rs, { key: seq, title, due: defaultDue }]); setSeq((n) => n + 1); };
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const patch = (key: number, field: "title" | "due", value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  return (
    <div>
      <label className="label">この商談から発生したタスク（任意・複数可）</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => add(p)} className="rounded-full border border-teal-primary/40 bg-teal-light/40 px-2.5 py-1 text-[11px] text-teal-deep hover:bg-teal-light">
            ＋{p}
          </button>
        ))}
        <button type="button" onClick={() => add()} className="rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-ink/60 hover:bg-black/[0.03] inline-flex items-center gap-0.5">
          <Plus size={11} /> 自由入力
        </button>
      </div>
      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-1.5">
              <input
                value={r.title}
                onChange={(e) => patch(r.key, "title", e.target.value)}
                name="task_title"
                placeholder="タスク名"
                className="input py-1 text-sm flex-1"
              />
              <input
                value={r.due}
                onChange={(e) => patch(r.key, "due", e.target.value)}
                name="task_due"
                type="date"
                className="input py-1 text-sm w-36"
                aria-label="期限"
              />
              <button type="button" onClick={() => remove(r.key)} className="text-ink/35 hover:text-rose-500 shrink-0" aria-label="このタスクを削除">
                <X size={15} />
              </button>
            </div>
          ))}
          <p className="text-[10px] text-ink/40">担当は商談担当と同じ、優先度は「中」で登録します（後からタスク画面で変更できます）。</p>
        </div>
      )}
    </div>
  );
}
