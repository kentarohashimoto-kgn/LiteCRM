"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { setProjectPortfolioAction } from "@/server/actions/tasks";

export function PortfolioProjectPicker({
  portfolioId,
  candidates,
}: {
  portfolioId: string;
  candidates: { id: string; name: string }[];
}) {
  const [, start] = useTransition();
  const [val, setVal] = useState("");
  if (candidates.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <select value={val} onChange={(e) => setVal(e.target.value)} className="input py-1.5 w-56 text-sm">
        <option value="">プロジェクトを選択…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!val}
        onClick={() => {
          if (val) start(() => setProjectPortfolioAction(val, portfolioId));
          setVal("");
        }}
        className="btn-ghost text-sm py-1.5 disabled:opacity-40"
      >
        <Plus size={15} /> 追加
      </button>
    </div>
  );
}
