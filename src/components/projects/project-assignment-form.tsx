"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveAssignmentAction } from "@/server/actions/projects";
import { computeCellCost, type RateUnit, type EffortUnit } from "@/lib/project-cost";
import { SubmitButton } from "@/components/ui/submit-button";

interface Cell { key: number; month: string; mm: string; ratio: string; hours: string }
interface Existing {
  id: string; kind: string; member_user_id: string | null; label: string; role: string | null;
  cost_rate: number; bill_rate: number | null; rate_unit: RateUnit; effort_unit: EffortUnit;
  start_month: string | null; end_month: string | null;
  cells: { month: string; manMonth: number; ratio: number; hours: number | null }[];
}

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

/** アサイン1件(＋月別の工数・稼働率・原価)を作成/編集。単価種別(人月/時給)・工数記述(率/時間)を選べる。 */
export function ProjectAssignmentForm({
  planId, oppId, members, seedMonths, hoursPerMonth, existing,
}: {
  planId: string; oppId: string; members: { id: string; name: string }[]; seedMonths: string[]; hoursPerMonth: number; existing?: Existing;
}) {
  const [kind, setKind] = useState(existing?.kind ?? "external");
  const [rateUnit, setRateUnit] = useState<RateUnit>(existing?.rate_unit ?? "man_month");
  const [effortUnit, setEffortUnit] = useState<EffortUnit>(existing?.effort_unit ?? "ratio");
  const [costRate, setCostRate] = useState(String(existing?.cost_rate ?? ""));
  const seedCells: Cell[] = existing?.cells.length
    ? existing.cells.map((c, i) => ({ key: i + 1, month: c.month, mm: String(c.manMonth || ""), ratio: String(c.ratio ?? 1), hours: c.hours == null ? "" : String(c.hours) }))
    : (seedMonths.length ? seedMonths : [""]).map((m, i) => ({ key: i + 1, month: m, mm: "", ratio: "1", hours: "" }));
  const [cells, setCells] = useState<Cell[]>(seedCells);
  const [seq, setSeq] = useState(seedCells.length + 1);

  const add = () => { setCells((cs) => [...cs, { key: seq, month: "", mm: "", ratio: "1", hours: "" }]); setSeq((n) => n + 1); };
  const remove = (key: number) => setCells((cs) => (cs.length > 1 ? cs.filter((c) => c.key !== key) : cs));
  const patch = (key: number, f: "month" | "mm" | "ratio" | "hours", v: string) =>
    setCells((cs) => cs.map((c) => (c.key === key ? { ...c, [f]: v } : c)));

  const rate = Number(costRate) || 0;
  const isHours = effortUnit === "hours";
  const cellCostOf = (c: Cell) =>
    computeCellCost({
      costRate: rate, rateUnit, effortUnit, hoursPerMonth,
      manMonth: isHours ? undefined : Number(c.mm) || 0,
      ratio: c.ratio === "" ? 1 : Number(c.ratio) || 0,
      hours: isHours ? Number(c.hours) || 0 : undefined,
    });
  const totalCost = cells.reduce((s, c) => s + cellCostOf(c), 0);

  return (
    <form action={saveAssignmentAction} className="space-y-3">
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="opportunity_id" value={oppId} />
      <input type="hidden" name="hours_per_month" value={hoursPerMonth} />
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
      </div>

      {/* 単価種別・工数記述 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">単価の種類</label>
          <select name="rate_unit" value={rateUnit} onChange={(e) => setRateUnit(e.target.value as RateUnit)} className="input">
            <option value="man_month">人月単価（円/人月）</option>
            <option value="hourly">時給（円/時）</option>
          </select>
        </div>
        <div>
          <label className="label">工数の記述</label>
          <select name="effort_unit" value={effortUnit} onChange={(e) => setEffortUnit(e.target.value as EffortUnit)} className="input">
            <option value="ratio">率（人月×稼働率）</option>
            <option value="hours">時間（h）</option>
          </select>
        </div>
        <div>
          <label className="label">{rateUnit === "hourly" ? "時給（円/時）*" : "原価単価（円/人月）*"}</label>
          <input name="cost_rate" type="number" required value={costRate} onChange={(e) => setCostRate(e.target.value)} className="input" placeholder={rateUnit === "hourly" ? "例：6250" : "例：1000000"} />
        </div>
        <div>
          <label className="label">請求単価（任意）</label>
          <input name="bill_rate" type="number" defaultValue={existing?.bill_rate ?? ""} className="input" />
        </div>
      </div>

      <div>
        <label className="label">
          月別の工数
          <span className="text-[10px] text-ink/40 ml-1">
            {isHours ? "時間(h)で入力・時間0の月は保存されません" : "人月×稼働%で入力・人月0の月は保存されません"}・1人月=<b>{hoursPerMonth}h</b>換算
          </span>
        </label>
        <div className="space-y-1.5">
          {cells.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <input type="month" name="cm_month" value={c.month} onChange={(e) => patch(c.key, "month", e.target.value)} className="input py-1 text-sm w-36" />
              {isHours ? (
                <>
                  <input type="number" step="1" value={c.hours} onChange={(e) => patch(c.key, "hours", e.target.value)} className="input py-1 text-sm w-28" placeholder="時間(h)" aria-label="時間" />
                  <input type="hidden" name="cm_hours" value={c.hours} />
                  <input type="hidden" name="cm_mm" value="0" />
                  <input type="hidden" name="cm_ratio" value="1" />
                </>
              ) : (
                <>
                  <input type="number" step="0.05" name="cm_mm" value={c.mm} onChange={(e) => patch(c.key, "mm", e.target.value)} className="input py-1 text-sm w-24" placeholder="人月" aria-label="人月" />
                  <div className="flex items-center gap-1">
                    <input type="number" step="1" min="0" max="100" value={ratioToPct(c.ratio)} onChange={(e) => patch(c.key, "ratio", pctToRatio(e.target.value))} className="input py-1 text-sm w-20" placeholder="稼働%" aria-label="稼働率%" />
                    <input type="hidden" name="cm_ratio" value={c.ratio === "" ? "1" : c.ratio} />
                    <span className="text-xs text-ink/40">%</span>
                  </div>
                  <input type="hidden" name="cm_hours" value="0" />
                </>
              )}
              <span className="text-xs text-ink/55 tabular-nums w-24 text-right ml-auto">{yen(cellCostOf(c))}</span>
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
