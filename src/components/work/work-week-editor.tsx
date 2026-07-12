"use client";

import { useState } from "react";
import { Plus, Trash2, Send, Save } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveWorkWeekAction, submitWorkWeekAction } from "@/server/actions/work-log";
import { parseHoursInput, formatHoursHM } from "@/lib/work-time";
import type { WorkEntry, WorkWeekStatus } from "@/lib/data/work-log";

type Row = {
  key: number;
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

/** 稼働時間の表示: 整数はそのまま、小数は h:mm 併記しやすい形に。 */
function hoursDisplay(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * 週次の稼働実績エディタ(報告スプレッドシートと同じ列構成)。
 * 保存=下書き、提出=承認依頼(以後ロック)。差戻し時は編集を再開できる。
 */
export function WorkWeekEditor({
  assignmentId,
  planId,
  weekStart,
  days,
  initial,
  status,
}: {
  assignmentId: string;
  planId: string;
  weekStart: string;
  days: string[]; // 週の7日(ISO)
  initial: WorkEntry[];
  status: WorkWeekStatus | null;
}) {
  const locked = status === "submitted" || status === "approved";
  const seed: Row[] =
    initial.length > 0
      ? initial.map((e, i) => ({
          key: i,
          date: e.work_date,
          hours: e.hours ? hoursDisplay(Number(e.hours)) : "",
          task: e.task_text ?? "",
          outcome: e.outcome_text ?? "",
          next: e.next_action_text ?? "",
          risk: e.risk_text ?? "",
          memo: e.memo ?? "",
        }))
      : [{ key: 0, date: days[0], hours: "", task: "", outcome: "", next: "", risk: "", memo: "" }];
  const [rows, setRows] = useState<Row[]>(seed);
  const [nextKey, setNextKey] = useState(seed.length);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    setRows((rs) => [...rs, { key: nextKey, date: rs[rs.length - 1]?.date ?? days[0], hours: "", task: "", outcome: "", next: "", risk: "", memo: "" }]);
    setNextKey((k) => k + 1);
  };
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const total = rows.reduce((s, r) => s + parseHoursInput(r.hours), 0);

  if (locked) {
    return (
      <div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 980 }}>
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr>
                <th className="th">日付</th><th className="th text-right">稼働時間</th><th className="th">タスク（カテゴリ＋内容）</th>
                <th className="th">成果（定量＋定性）</th><th className="th">Next Action</th><th className="th">リスク・懸念</th><th className="th">メモ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {initial.map((e) => (
                <tr key={e.id}>
                  <td className="td whitespace-nowrap">{dayLabel(e.work_date)}</td>
                  <td className="td text-right tabular-nums">{formatHoursHM(Number(e.hours) || 0)}</td>
                  <td className="td text-xs">{e.task_text ?? "—"}</td>
                  <td className="td text-xs">{e.outcome_text ?? "—"}</td>
                  <td className="td text-xs">{e.next_action_text ?? "—"}</td>
                  <td className="td text-xs">{e.risk_text ?? "—"}</td>
                  <td className="td text-xs">{e.memo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-sm tabular-nums text-ink/70">
          週合計 <span className="font-bold">{formatHoursHM(initial.reduce((s, e) => s + (Number(e.hours) || 0), 0))}</span>
          <span className="ml-3 text-xs text-ink/45">{status === "approved" ? "承認済みのため編集できません" : "提出済み（承認待ち）のため編集できません"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form action={saveWorkWeekAction}>
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="week_start" value={weekStart} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 1080 }}>
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr>
                <th className="th" style={{ width: 110 }}>日付</th>
                <th className="th" style={{ width: 90 }}>稼働時間</th>
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
          </div>
          <SubmitButton className="btn-primary inline-flex items-center gap-1.5 text-sm" pendingLabel="保存中…">
            <Save size={14} /> 下書き保存
          </SubmitButton>
        </div>
      </form>

      <form
        action={submitWorkWeekAction}
        onSubmit={(e) => {
          if (!confirm("この週の実績を提出しますか？提出後は承認・差戻しまで編集できません。\n※未保存の変更は含まれません。先に「下書き保存」してください。")) e.preventDefault();
        }}
        className="flex justify-end border-t border-black/[0.04] pt-2.5"
      >
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="week_start" value={weekStart} />
        <SubmitButton className="btn-accent inline-flex items-center gap-1.5 text-sm" pendingLabel="提出中…">
          <Send size={14} /> この週を提出（承認依頼）
        </SubmitButton>
      </form>
    </div>
  );
}
