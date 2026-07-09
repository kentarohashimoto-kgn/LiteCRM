"use client";

import { useEffect, useMemo, useState } from "react";
import { saveWeeklyReportAction } from "@/server/actions/projects";
import { computeCellCost, type RateUnit, type EffortUnit } from "@/lib/project-cost";
import { SubmitButton } from "@/components/ui/submit-button";

interface Asg {
  id: string; label: string; cost_rate: number; rate_unit: RateUnit; effort_unit: EffortUnit;
}
type Period = "weekly" | "monthly" | "final";
const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const ymLabel = (m: string) => (m ? `${m.split("-")[0]}/${Number(m.split("-")[1])}` : "");

/**
 * 実績の入力。週次 / 月次 / 終了時 の3段階。
 *  - 週次: アサインの単価×工数記述で工数→原価を自動計算(全体は直接入力)
 *  - 月次: 選んだ月の予定をコピーして実績記入のベースにする
 *  - 終了時: 案件全体の予定をコピーして実績記入のベースにする
 */
export function ProjectWeeklyForm({
  planId, oppId, assignments, hoursPerMonth, monthlyPlan, totalPlanCost,
}: {
  planId: string; oppId: string; assignments: Asg[]; hoursPerMonth: number;
  monthlyPlan: { month: string; cost: number }[]; totalPlanCost: number;
}) {
  const [period, setPeriod] = useState<Period>("weekly");

  // ---- 週次 ----
  const [asgId, setAsgId] = useState("");
  const [plannedEffort, setPlannedEffort] = useState("");
  const [actualEffort, setActualEffort] = useState("");
  const [plannedCostManual, setPlannedCostManual] = useState("");
  const [actualCostManual, setActualCostManual] = useState("");
  const asg = useMemo(() => assignments.find((a) => a.id === asgId), [assignments, asgId]);
  const effortUnit = asg?.effort_unit ?? "ratio";
  const effortLabel = effortUnit === "hours" ? "時間(h)" : "人月";
  const calc = (effort: string) => {
    const e = Number(effort) || 0;
    if (!asg) return { cost: 0, mm: 0 };
    const isHours = effortUnit === "hours";
    const cost = computeCellCost({ costRate: asg.cost_rate, rateUnit: asg.rate_unit, effortUnit, hoursPerMonth, manMonth: isHours ? undefined : e, ratio: 1, hours: isHours ? e : undefined });
    const mm = isHours ? (hoursPerMonth > 0 ? e / hoursPerMonth : 0) : e;
    return { cost, mm };
  };
  const wp = calc(plannedEffort);
  const wa = calc(actualEffort);
  const wPlannedCost = asg ? wp.cost : Number(plannedCostManual) || 0;
  const wActualCost = asg ? wa.cost : Number(actualCostManual) || 0;

  // ---- 月次: 選択月の予定をコピー ----
  const planByMonth = useMemo(() => new Map(monthlyPlan.map((m) => [m.month, m.cost])), [monthlyPlan]);
  const [month, setMonth] = useState(monthlyPlan[0]?.month ?? "");
  const monthPlanned = planByMonth.get(month) ?? 0;
  const [monthActual, setMonthActual] = useState("");
  // 月を選び直したら実績の初期値を予定でコピー
  useEffect(() => { setMonthActual(String(Math.round(monthPlanned))); }, [month, monthPlanned]);

  // ---- 終了時: 全体の予定をコピー ----
  const [finalActual, setFinalActual] = useState(String(Math.round(totalPlanCost)));

  // 送信値
  const plannedCost = period === "weekly" ? wPlannedCost : period === "monthly" ? monthPlanned : totalPlanCost;
  const actualCost = period === "weekly" ? wActualCost : period === "monthly" ? Number(monthActual) || 0 : Number(finalActual) || 0;
  const diff = actualCost - plannedCost;

  return (
    <form action={saveWeeklyReportAction} className="space-y-3">
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="opportunity_id" value={oppId} />
      <input type="hidden" name="period_type" value={period} />
      <input type="hidden" name="planned_cost" value={String(Math.round(plannedCost))} />
      <input type="hidden" name="actual_cost" value={String(Math.round(actualCost))} />
      {period === "weekly" && <input type="hidden" name="planned_mm" value={asg ? String(wp.mm) : ""} />}
      {period === "weekly" && <input type="hidden" name="actual_mm" value={asg ? String(wa.mm) : ""} />}
      {period === "monthly" && <input type="hidden" name="period_month" value={month} />}

      {/* 期間種別 */}
      <div>
        <label className="label">記入する期間</label>
        <div className="flex gap-1.5">
          {([["weekly", "週次"], ["monthly", "月次"], ["final", "終了時"]] as [Period, string][]).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={`rounded-lg px-3 py-1.5 text-sm border ${period === k ? "border-teal-primary bg-teal-light/50 text-teal-deep font-semibold" : "border-black/10 text-ink/55 hover:bg-black/[0.03]"}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {period === "weekly" && (
        <>
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
                  <div className="text-[11px] text-ink/50 mt-0.5">予定原価 {yen(wPlannedCost)}</div>
                </div>
                <div>
                  <label className="label text-[11px]">実績工数（{effortLabel}）</label>
                  <input type="number" step="0.05" value={actualEffort} onChange={(e) => setActualEffort(e.target.value)} className="input py-1 text-sm" />
                  <div className="text-[11px] text-ink/50 mt-0.5">実績原価 {yen(wActualCost)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">予定原価</label><input type="number" value={plannedCostManual} onChange={(e) => setPlannedCostManual(e.target.value)} className="input" /></div>
              <div><label className="label">実績原価</label><input type="number" value={actualCostManual} onChange={(e) => setActualCostManual(e.target.value)} className="input" /></div>
            </div>
          )}
        </>
      )}

      {period === "monthly" && (
        <div className="rounded-lg border border-black/[0.06] bg-mist-soft/20 p-2.5 space-y-2">
          <div className="text-[11px] text-ink/45">対象月を選ぶと、その月の<b>予定原価をコピー</b>して実績のベースにします。差分だけ直せば記入完了です。</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">対象月</label>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="input">
                {monthlyPlan.length === 0 && <option value="">—（先に販売/アサインを登録）</option>}
                {monthlyPlan.map((m) => <option key={m.month} value={m.month}>{ymLabel(m.month)}（予定 {yen(m.cost)}）</option>)}
              </select>
            </div>
            <div>
              <label className="label">実績原価（予定をコピー済）</label>
              <input type="number" value={monthActual} onChange={(e) => setMonthActual(e.target.value)} className="input" />
              <div className="text-[11px] text-ink/50 mt-0.5">予定 {yen(monthPlanned)}</div>
            </div>
          </div>
        </div>
      )}

      {period === "final" && (
        <div className="rounded-lg border border-black/[0.06] bg-mist-soft/20 p-2.5 space-y-2">
          <div className="text-[11px] text-ink/45">案件全体の<b>予定原価をコピー</b>して着地実績のベースにします。最終差分だけ直してください。</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">予定原価（全体）</label>
              <div className="input bg-mist-soft/40 text-ink/70 flex items-center tabular-nums">{yen(totalPlanCost)}</div>
            </div>
            <div>
              <label className="label">着地実績原価（予定をコピー済）</label>
              <input type="number" value={finalActual} onChange={(e) => setFinalActual(e.target.value)} className="input" />
            </div>
          </div>
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
      <SubmitButton className="btn-accent" pendingLabel="記録中…">実績を記録</SubmitButton>
    </form>
  );
}
