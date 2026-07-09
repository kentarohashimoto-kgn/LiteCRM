"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveRevenueMonthsAction } from "@/server/actions/projects";
import { SubmitButton } from "@/components/ui/submit-button";

interface Row { key: number; month: string; amount: string }

/** 月別の販売(売上)計画エディタ。planId/oppId と、期間から生成した月・既存値を受け取る。 */
export function ProjectRevenueForm({
  planId, oppId, seedMonths, initial,
}: {
  planId: string; oppId: string; seedMonths: string[]; initial: { month: string; amount: number }[];
}) {
  const initialMap = new Map(initial.map((r) => [r.month, r.amount]));
  const months = [...new Set([...seedMonths, ...initial.map((r) => r.month)])].sort();
  const seed: Row[] = (months.length ? months : [""]).map((m, i) => ({
    key: i + 1, month: m, amount: initialMap.has(m) ? String(initialMap.get(m)) : "",
  }));
  const [rows, setRows] = useState<Row[]>(seed);
  const [seq, setSeq] = useState(seed.length + 1);

  const add = () => { setRows((rs) => [...rs, { key: seq, month: "", amount: "" }]); setSeq((n) => n + 1); };
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const patch = (key: number, f: "month" | "amount", v: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [f]: v } : r)));

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <form action={saveRevenueMonthsAction} className="space-y-2">
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="opportunity_id" value={oppId} />
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <input type="month" name="rev_month" value={r.month} onChange={(e) => patch(r.key, "month", e.target.value)} className="input py-1 text-sm w-40" />
            <div className="relative flex-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">¥</span>
              <input type="number" name="rev_amount" value={r.amount} onChange={(e) => patch(r.key, "amount", e.target.value)} className="input py-1 text-sm pl-5" placeholder="販売額" />
            </div>
            <button type="button" onClick={() => remove(r.key)} className="text-ink/35 hover:text-rose-500 shrink-0" aria-label="削除"><X size={15} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline"><Plus size={13} /> 月を追加</button>
        <span className="text-xs text-ink/50 tabular-nums">合計 ¥{total.toLocaleString("ja-JP")}</span>
      </div>
      <SubmitButton className="btn-primary" pendingLabel="保存中…">販売計画を保存</SubmitButton>
    </form>
  );
}
