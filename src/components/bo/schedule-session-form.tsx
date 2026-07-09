"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { scheduleTrainingSessionAction } from "@/server/actions/bo";
import { SubmitButton } from "@/components/ui/submit-button";

interface Instructor { id: string; name: string; }
interface Deal { account_name: string | null; name: string; }
interface DateRow { key: number; held_on: string; start_time: string; end_time: string; part: string; url: string; }

/**
 * 研修予定の登録フォーム。
 * 企業(成約済研修案件から選択)・研修種類・会場・受講者数・講師を1回入力し、
 * 実施日(＋開始/終了/研修パート/会議URL)を「日程を追加」で複数まとめて登録できる。
 */
export function ScheduleSessionForm({ instructors, deals }: { instructors: Instructor[]; deals: Deal[] }) {
  const [rows, setRows] = useState<DateRow[]>([{ key: 1, held_on: "", start_time: "", end_time: "", part: "Day1", url: "" }]);
  const [seq, setSeq] = useState(2);

  const addRow = () => {
    setRows((rs) => [...rs, { key: seq, held_on: "", start_time: "", end_time: "", part: `Day${rs.length + 1}`, url: "" }]);
    setSeq((n) => n + 1);
  };
  const removeRow = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const patch = (key: number, field: keyof DateRow, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  // 企業候補(成約済研修案件の会社名、重複除去)
  const companies = Array.from(new Set(deals.map((d) => d.account_name).filter((n): n is string => !!n)));

  return (
    <form action={scheduleTrainingSessionAction} className="space-y-2.5">
      <div>
        <label className="label">受講企業（成約済みの研修案件から選択・直接入力も可）</label>
        <input name="account_name" list="fu-company-list" className="input" placeholder="会社名" />
        <datalist id="fu-company-list">
          {companies.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div>
        <label className="label">研修種類 *</label>
        <input name="course" required className="input" placeholder="例: 生成AI基礎" />
      </div>
      <div>
        <label className="label">講師</label>
        <select name="instructor_id" className="input" defaultValue="">
          <option value="">（未定）</option>
          {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">会場</label><input name="venue" className="input" placeholder="訪問/オンライン等" /></div>
        <div><label className="label">受講者数</label><input name="attendee_count" type="number" min={0} className="input" /></div>
      </div>

      <div className="pt-1">
        <label className="label">実施日（複数回まとめて登録できます）</label>
        <div className="space-y-2">
          {rows.map((r, idx) => (
            <div key={r.key} className="rounded-lg border border-black/[0.06] p-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[11px] text-ink/45 tabular-nums">第{idx + 1}回</span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(r.key)} className="ml-auto text-ink/35 hover:text-rose-500" aria-label="この日程を削除">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label text-[10px]">実施日</label>
                  <input name="held_on" type="date" value={r.held_on} onChange={(e) => patch(r.key, "held_on", e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label text-[10px]">開始</label>
                  <input name="start_time" type="time" value={r.start_time} onChange={(e) => patch(r.key, "start_time", e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label text-[10px]">終了</label>
                  <input name="end_time" type="time" value={r.end_time} onChange={(e) => patch(r.key, "end_time", e.target.value)} className="input" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                <div>
                  <label className="label text-[10px]">研修パート</label>
                  <input name="session_part" value={r.part} onChange={(e) => patch(r.key, "part", e.target.value)} className="input" placeholder="例: Day1 基礎編" />
                </div>
                <div className="col-span-2">
                  <label className="label text-[10px]">会議URL</label>
                  <input name="meeting_url" type="url" value={r.url} onChange={(e) => patch(r.key, "url", e.target.value)} className="input" placeholder="Zoom / Teams 等" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1 text-xs text-teal-deep hover:underline">
          <Plus size={14} /> 日程を追加
        </button>
      </div>

      <SubmitButton className="btn-accent" pendingLabel="登録中…">予定を追加</SubmitButton>
    </form>
  );
}
