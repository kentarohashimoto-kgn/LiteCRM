"use client";

import { useMemo, useState } from "react";
import { saveWeeklyReportAction } from "@/server/actions/projects";
import { computeCellCost, type RateUnit, type EffortUnit } from "@/lib/project-cost";
import { SubmitButton } from "@/components/ui/submit-button";

interface Asg {
  id: string; label: string; cost_rate: number; rate_unit: RateUnit; effort_unit: EffortUnit;
}
const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

/**
 * 週次実績の入力。予定・実績を「同じ考え方」(アサインの単価種別×工数記述)で入力し、
 * 工数から原価を自動計算する。アサイン未選択(全体)のときは原価を直接入力。
 */
export function ProjectWeeklyForm({
  planId, oppId, assignments, hoursPerMonth,
}: {
  planId: string; oppId: string; assignments: Asg[]; hoursPerMonth: number;
}) {
  const [asgId, setAsgId] = useState("");
  const [plannedEffort, setPlannedEffort] = useState("");
  const [actualEffort, setActualEffort] = useState("");
  const [plannedCostManual, setPlannedCostManual] = useState("");
  const [actualCostManual, setActualCostManual] = useState("");

  const asg = useMemo(() => assignments.find((a) => a.id === asgId), [assignments, asgId]);
  const effortUnit = asg?.effort_unit ?? "ratio";
  const effortLabel = effortUnit === "hours" ? "時間(h)" : "人月";

  // 工数(人月 or 時間)→ 原価・実効人月
  const calc = (effort: string) => {
    const e = Number(effort) || 0;
    if (!asg) return { cost: 0, mm: 0 };
    const isHours = effortUnit === "hours";
    const cost = computeCellCost({
      costRate: asg.cost_rate, rateUnit: asg.rate_unit, effortUnit, hoursPerMonth,
      manMonth: isHours ? undefined : e, ratio: 1, hours: isHours ? e : undefined,
    });
    const mm = isHours ? (hoursPerMonth > 0 ? e / hoursPerMonth : 0) : e;
    return { cost, mm };
  };
  const p = calc(plannedEffort);
  const a = calc(actualEffort);

  const plannedCost = asg ? p.cost : Number(plannedCostManual) || 0;
  const actualCost = asg ? a.cost : Number(actualCostManual) || 0;
  const diff = actualCost - plannedCost;

  return (
    <form action={saveWeeklyReportAction} className="space-y-3">
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="opportunity_id" value={oppId} />
      {/* 計算値を送信 */}
      <input type="hidden" name="planned_cost" value={String(Math.round(plannedCost))} />
      <input type="hidden" name="actual_cost" value={String(Math.round(actualCost))} />
      <input type="hidden" name="planned_mm" value={asg ? String(p.mm) : ""} />
      <input type="hidden" name="actual_mm" value={asg ? String(a.mm) : ""} />

      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">週（月曜日）*</label><input name="week_start" type="date" required className="input" /></div>
        <div>
          <label className="label">アサイン</label>
          <select name="assignment_id" value={asgId} onChange={(e) => setAsgId(e.target.value)} className="input">
            <option value="">全体（原価を直接入力）</option>
            {assignments.map((x) => <option key={x.id} value={x.id}>{x.label}（{x.effort_unit === "hours" ? "時間" : "率"}/{x.rate_unit === "hourly" ? "時給" : "人月"}）</option>)}
          </select>
        </div>
      </div>

      {asg ? (
        <div className="rounded-lg border border-black/[0.06] bg-mist-soft/20 p-2.5">
          <div className="text-[11px] text-ink/45 mb-1.5">工数を{effortLabel}で入力 → 原価を自動計算（単価 {yen(asg.cost_rate)}/{asg.rate_unit === "hourly" ? "h" : "人月"}）</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-[11px]">予定工数（{effortLabel}）</label>
              <input type="number" step="0.05" value={plannedEffort} onChange={(e) => setPlannedEffort(e.target.value)} className="input py-1 text-sm" />
              <div className="text-[11px] text-ink/50 mt-0.5">予定原価 {yen(plannedCost)}</div>
            </div>
            <div>
              <label className="label text-[11px]">実績工数（{effortLabel}）</label>
              <input type="number" step="0.05" value={actualEffort} onChange={(e) => setActualEffort(e.target.value)} className="input py-1 text-sm" />
              <div className="text-[11px] text-ink/50 mt-0.5">実績原価 {yen(actualCost)}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">予定原価</label><input type="number" value={plannedCostManual} onChange={(e) => setPlannedCostManual(e.target.value)} className="input" /></div>
          <div><label className="label">実績原価</label><input type="number" value={actualCostManual} onChange={(e) => setActualCostManual(e.target.value)} className="input" /></div>
        </div>
      )}

      <div className={`text-xs tabular-nums ${diff > 0 ? "text-rose-600" : "text-emerald-600"}`}>予実差異：{diff > 0 ? "+" : ""}{yen(diff)}</div>

      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">進捗率(%)</label><input name="progress_pct" type="number" min={0} max={100} className="input" /></div>
        <div><label className="label">状態</label>
          <select name="status" defaultValue="on_track" className="input">
            <option value="on_track">順調</option><option value="watch">要注意</option><option value="over">超過</option><option value="blocked">停滞</option>
          </select>
        </div>
      </div>
      <div><label className="label">報告者（外注名など）</label><input name="reporter" className="input" /></div>
      <div><label className="label">ブロッカー・特記</label><textarea name="blockers" rows={2} className="input" /></div>
      <SubmitButton className="btn-accent" pendingLabel="記録中…">週次実績を記録</SubmitButton>
    </form>
  );
}
