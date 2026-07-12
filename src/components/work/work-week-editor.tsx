"use client";

import { useState } from "react";
import { Plus, Trash2, Send, Save } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveWorkWeekAction, submitWorkWeekAction } from "@/server/actions/work-log";
import { parseHoursInput, formatHoursHM, GENERAL_UNIT } from "@/lib/work-time";
import type { WorkEntry } from "@/lib/data/work-log";

/** 記入単位(担当者ごとの案件マスター+全般稼働)。 */
export interface WorkUnit {
  key: string; // assignment_id or GENERAL_UNIT
  label: string; // 例: 取引先｜案件名 / 全般稼働
}

type Row = {
  key: number;
  unit: string;
  date: string;
  hours: string;
  task: string;
  outcome: string;
  next: string;
  risk: string;
  memo: string;
};

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`;
}

/** 稼働時間の表示: 整数はそのまま、小数は編集しやすい10進で。 */
function hoursDisplay(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function entryUnitKey(e: WorkEntry): string {
  return e.assignment_id ?? GENERAL_UNIT;
}

/**
 * 週次の稼働実績エディタ(報告スプレッドシートと同じ列構成+「案件」列)。
 * 行ごとに紐づき先(担当者の案件マスター or 全般稼働)を選ぶ。
 * 保存=下書き、提出=記入がある全単位をまとめて承認依頼(以後ロック)。
 */
export function WorkWeekEditor({
  units,
  weekStart,
  days,
  initial,
  hasLockedUnits,
}: {
  units: WorkUnit[]; // 編集可能な単位のみ
  weekStart: string;
  days: string[]; // 週の7日(ISO)
  initial: WorkEntry[]; // 編集可能な単位の既存行
  hasLockedUnits: boolean; // 提出済み/承認済みの単位が同じ週にあるか(注記用)
}) {
  const defaultUnit = units[0]?.key ?? GENERAL_UNIT;
  const seed: Row[] =
    initial.length > 0
      ? initial.map((e, i) => ({
          key: i,
          unit: entryUnitKey(e),
          date: e.work_date,
          hours: e.hours ? hoursDisplay(Number(e.hours)) : "",
          task: e.task_text ?? "",
          outcome: e.outcome_text ?? "",
          next: e.next_action_text ?? "",
          risk: e.risk_text ?? "",
          memo: e.memo ?? "",
        }))
      : [{ key: 0, unit: defaultUnit, date: days[0], hours: "", task: "", outcome: "", next: "", risk: "", memo: "" }];
  const [rows, setRows] = useState<Row[]>(seed);
  const [nextKey, setNextKey] = useState(seed.length);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    setRows((rs) => [
      ...rs,
      { key: nextKey, unit: rs[rs.length - 1]?.unit ?? defaultUnit, date: rs[rs.length - 1]?.date ?? days[0], hours: "", task: "", outcome: "", next: "", risk: "", memo: "" },
    ]);
    setNextKey((k) => k + 1);
  };
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const total = rows.reduce((s, r) => s + parseHoursInput(r.hours), 0);
  const showUnitCol = units.length > 1;

  return (
    <div className="space-y-3">
      <form action={saveWorkWeekAction}>
        <input type="hidden" name="week_start" value={weekStart} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: showUnitCol ? 1180 : 1040 }}>
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr>
                <th className="th" style={{ width: 108 }}>日付</th>
                <th className="th" style={{ width: 86 }}>稼働時間</th>
                {showUnitCol && <th className="th" style={{ width: 190 }}>案件</th>}
                <th className="th">タスク（カテゴリ＋内容）</th>
                <th className="th">成果（定量＋定性）</th>
                <th className="th">Next Action</th>
                <th className="th">リスク・懸念</th>
                <th className="th">メモ</th>
                <th className="th" style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-black/[0.04] align-top">
                  <td className="td">
                    {!showUnitCol && <input type="hidden" name="e_unit" value={r.unit} />}
                    <select name="e_date" value={r.date} onChange={(e) => set(r.key, { date: e.target.value })} className="input text-xs" aria-label="日付">
                      {days.map((d) => (
                        <option key={d} value={d}>{dayLabel(d)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <input
                      name="e_hours"
                      value={r.hours}
                      onChange={(e) => set(r.key, { hours: e.target.value })}
                      placeholder="1.5 / 1:30"
                      inputMode="decimal"
                      className="input text-right text-xs"
                      aria-label="稼働時間"
                    />
                  </td>
                  {showUnitCol && (
                    <td className="td">
                      <select name="e_unit" value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} className="input text-xs" aria-label="案件" title="この稼働をどの案件の原価に紐づけるか">
                        {units.map((u) => (
                          <option key={u.key} value={u.key}>{u.label}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="td"><input name="e_task" value={r.task} onChange={(e) => set(r.key, { task: e.target.value })} className="input text-xs" placeholder="例: 研修参加、提案書素案の作成" /></td>
                  <td className="td"><input name="e_outcome" value={r.outcome} onChange={(e) => set(r.key, { outcome: e.target.value })} className="input text-xs" placeholder="例: 進行の理解、素案完成" /></td>
                  <td className="td"><input name="e_next" value={r.next} onChange={(e) => set(r.key, { next: e.target.value })} className="input text-xs" placeholder="例: 7/2に次回MTG" /></td>
                  <td className="td"><input name="e_risk" value={r.risk} onChange={(e) => set(r.key, { risk: e.target.value })} className="input text-xs" /></td>
                  <td className="td"><input name="e_memo" value={r.memo} onChange={(e) => set(r.key, { memo: e.target.value })} className="input text-xs" /></td>
                  <td className="td">
                    <button type="button" onClick={() => remove(r.key)} className="text-ink/30 hover:text-rose-600 mt-1.5" title="行を削除" aria-label="行を削除">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={add} className="btn-ghost inline-flex items-center gap-1 text-xs">
              <Plus size={13} /> 行を追加
            </button>
            <span className="text-sm tabular-nums text-ink/70">週合計 <span className="font-bold">{formatHoursHM(total)}</span></span>
            {hasLockedUnits && <span className="text-xs text-ink/45">※ 提出済み・承認済みの案件の行は下の一覧に表示されています(編集不可)</span>}
          </div>
          <SubmitButton className="btn-primary inline-flex items-center gap-1.5 text-sm" pendingLabel="保存中…">
            <Save size={14} /> 下書き保存
          </SubmitButton>
        </div>
      </form>

      <form
        action={submitWorkWeekAction}
        onSubmit={(e) => {
          if (!confirm("この週の実績を提出しますか？記入のある案件・全般稼働がまとめて承認依頼されます。\n提出後は承認・差戻しまで編集できません。\n※未保存の変更は含まれません。先に「下書き保存」してください。")) e.preventDefault();
        }}
        className="flex justify-end border-t border-black/[0.04] pt-2.5"
      >
        <input type="hidden" name="week_start" value={weekStart} />
        <SubmitButton className="btn-accent inline-flex items-center gap-1.5 text-sm" pendingLabel="提出中…">
          <Send size={14} /> この週を提出（承認依頼）
        </SubmitButton>
      </form>
    </div>
  );
}
