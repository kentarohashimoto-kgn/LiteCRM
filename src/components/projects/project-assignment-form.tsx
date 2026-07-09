"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveAssignmentAction } from "@/server/actions/projects";
import { SubmitButton } from "@/components/ui/submit-button";

interface Cell { key: number; month: string; mm: string; ratio: string }
interface Existing {
  id: string; kind: string; member_user_id: string | null; label: string; role: string | null;
  cost_rate: number; bill_rate: number | null; start_month: string | null; end_month: string | null;
  cells: { month: string; manMonth: number; ratio: number }[];
}

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

/** アサイン1件(＋月別の工数・稼働率・原価)を作成/編集するフォーム。 */
export function ProjectAssignmentForm({
  planId, oppId, members, seedMonths, existing,
}: {
  planId: string; oppId: string; members: { id: string; name: string }[]; seedMonths: string[]; existing?: Existing;
}) {
  const [kind, setKind] = useState(existing?.kind ?? "external");
  const [costRate, setCostRate] = useState(String(existing?.cost_rate ?? ""));
  const seedCells: Cell[] = existing?.cells.length
    ? existing.cells.map((c, i) => ({ key: i + 1, month: c.month, mm: String(c.manMonth), ratio: String(c.ratio) }))
    : (seedMonths.length ? seedMonths : [""]).map((m, i) => ({ key: i + 1, month: m, mm: "", ratio: "1" }));
  const [cells, setCells] = useState<Cell[]>(seedCells);
  const [seq, setSeq] = useState(seedCells.length + 1);

  const add = () => { setCells((cs) => [...cs, { key: seq, month: "", mm: "", ratio: "1" }]); setSeq((n) => n + 1); };
  const remove = (key: number) => setCells((cs) => (cs.length > 1 ? cs.filter((c) => c.key !== key) : cs));
  const patch = (key: number, f: "month" | "mm" | "ratio", v: string) =>
    setCells((cs) => cs.map((c) => (c.key === key ? { ...c, [f]: v } : c)));

  const rate = Number(costRate) || 0;
  const cellCostOf = (c: Cell) => rate * (Number(c.mm) || 0) * (c.ratio === "" ? 1 : Number(c.ratio) || 0);
  const totalCost = cells.reduce((s, c) => s + cellCostOf(c), 0);

  return (
    <form action={saveAssignmentAction} className="space-y-3">
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="opportunity_id" value={oppId} />
      {existing && <input type="hidden" name="assignment_id" value={existing.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">区分</label>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            <option value="external">外注</option>
            <option value="internal">社員</option>
          </select>
        </div>
        {kind === "internal" ? (
          <div>
            <label className="label">社員</label>
            <select name="member_user_id" defaultValue={existing?.member_user_id ?? ""} className="input">
              <option value="">—</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        ) : <div />}
        <div>
          <label className="label">表示名 *</label>
          <input name="label" required defaultValue={existing?.label ?? ""} className="input" placeholder="例：コンサルA / ○○社(外注)" />
        </div>
        <div>
          <label className="label">役割</label>
          <input name="role" defaultValue={existing?.role ?? ""} className="input" placeholder="例：コンサル / PM / エンジニア" />
        </div>
        <div>
          <label className="label">原価単価（円/人月）*</label>
          <input name="cost_rate" type="number" required value={costRate} onChange={(e) => setCostRate(e.target.value)} className="input" placeholder="例：1000000" />
        </div>
        <div>
          <label className="label">請求単価（円/人月・任意）</label>
          <input name="bill_rate" type="number" defaultValue={existing?.bill_rate ?? ""} className="input" />
        </div>
      </div>

      <div>
        <label className="label">月別の工数・稼働率（工数0の月は保存されません）</label>
        <div className="space-y-1.5">
          {cells.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <input type="month" name="cm_month" value={c.month} onChange={(e) => patch(c.key, "month", e.target.value)} className="input py-1 text-sm w-36" />
              <input type="number" step="0.05" name="cm_mm" value={c.mm} onChange={(e) => patch(c.key, "mm", e.target.value)} className="input py-1 text-sm w-24" placeholder="人月" aria-label="人月" />
              <div className="flex items-center gap-1">
                {/* 表示は稼働%、送信は比率(0..1)を hidden で */}
                <input type="number" step="1" min="0" max="100" value={ratioToPct(c.ratio)} onChange={(e) => patch(c.key, "ratio", pctToRatio(e.target.value))} className="input py-1 text-sm w-20" placeholder="稼働%" aria-label="稼働率%" />
                <input type="hidden" name="cm_ratio" value={c.ratio === "" ? "1" : c.ratio} />
                <span className="text-xs text-ink/40">%</span>
              </div>
              <span className="text-xs text-ink/55 tabular-nums w-24 text-right">{yen(cellCostOf(c))}</span>
              <button type="button" onClick={() => remove(c.key)} className="text-ink/35 hover:text-rose-500 shrink-0" aria-label="削除"><X size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1.5">
          <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline"><Plus size={13} /> 月を追加</button>
          <span className="text-xs text-ink/55 tabular-nums">このアサインの原価合計 <b className="text-ink/80">{yen(totalCost)}</b></span>
        </div>
      </div>

      <SubmitButton className="btn-accent" pendingLabel="保存中…">アサインを保存</SubmitButton>
    </form>
  );
}

// 内部は比率(0..1)で送信するが、UIは稼働%で扱う。
function ratioToPct(ratio: string): string {
  if (ratio === "") return "100";
  const n = Number(ratio);
  return Number.isFinite(n) ? String(Math.round(n * 100)) : "100";
}
function pctToRatio(pct: string): string {
  const n = Number(pct);
  return Number.isFinite(n) ? String(Math.max(0, Math.min(1, n / 100))) : "1";
}
