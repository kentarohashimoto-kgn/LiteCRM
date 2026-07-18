"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, X, Archive, RotateCcw } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMAIL_CATEGORY_LABEL } from "@/lib/email";
import { saveSequenceAction, archiveSequenceAction } from "@/server/actions/sequences";
import type { SequenceRow } from "@/app/app/email/sequences/page";
import type { EmailTemplate } from "@/app/app/email/templates/page";

interface StepEdit { wait_days: number; template_id: string }

function SequenceForm({ seq, templates, onClose }: { seq?: SequenceRow; templates: EmailTemplate[]; onClose?: () => void }) {
  const [steps, setSteps] = useState<StepEdit[]>(
    seq?.steps?.length ? seq.steps.map((s) => ({ wait_days: s.wait_days, template_id: s.template_id })) : [{ wait_days: 0, template_id: templates[0]?.id ?? "" }],
  );
  const setStep = (i: number, patch: Partial<StepEdit>) => setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = () => setSteps((prev) => [...prev, { wait_days: 3, template_id: templates[0]?.id ?? "" }]);
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, j) => j !== i));

  return (
    <form action={saveSequenceAction} className="rounded-xl border border-teal-200 bg-teal-50/30 p-4 space-y-3">
      {seq && <input type="hidden" name="id" value={seq.id} />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink/60 mb-1">名称<span className="text-rose-500">*</span></label>
          <input name="name" defaultValue={seq?.name ?? ""} className="input" placeholder="例: 初回商談フォロー" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/60 mb-1">説明</label>
          <input name="description" defaultValue={seq?.description ?? ""} className="input" placeholder="任意" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">ステップ（上から順に送信）</label>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-ink/40 w-6">#{i + 1}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0} value={s.wait_days}
                  onChange={(e) => setStep(i, { wait_days: parseInt(e.target.value || "0", 10) })}
                  name="step_wait" className="input w-20 text-sm" />
                <span className="text-xs text-ink/50">日後</span>
              </div>
              <select value={s.template_id} name="step_template" onChange={(e) => setStep(i, { template_id: e.target.value })} className="input flex-1 text-sm">
                <option value="">（定型文を選択）</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{EMAIL_CATEGORY_LABEL[t.category] ?? t.category}｜{t.name}</option>
                ))}
              </select>
              {steps.length > 1 && (
                <button type="button" onClick={() => removeStep(i)} className="text-ink/40 hover:text-rose-600 p-1"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addStep} className="btn-ghost inline-flex items-center gap-1 text-xs text-teal-700 mt-2">
          <Plus size={12} /> ステップを追加
        </button>
        {templates.length === 0 && <p className="text-[11px] text-amber-600 mt-1">定型文がありません。先に「定型文を管理」で作成してください。</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">自動停止条件</label>
        <div className="flex flex-wrap gap-4 text-xs text-ink/70">
          <label className="flex items-center gap-1.5"><input type="checkbox" name="on_won" defaultChecked={seq?.stop_on?.on_won ?? true} /> 受注したら停止</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="on_lost" defaultChecked={seq?.stop_on?.on_lost ?? true} /> 失注/キャンセルで停止</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="on_appointment" defaultChecked={seq?.stop_on?.on_appointment ?? false} /> アポ化で停止</label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn-accent text-sm">{seq ? "更新する" : "作成する"}</SubmitButton>
        {onClose && <button type="button" onClick={onClose} className="btn-ghost text-sm text-ink/50 inline-flex items-center gap-1"><X size={14} /> キャンセル</button>}
      </div>
    </form>
  );
}

export function SequenceBuilder({ sequences, templates, canEdit }: { sequences: SequenceRow[]; templates: EmailTemplate[]; canEdit: boolean }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {canEdit && (creating ? (
        <SequenceForm templates={templates} onClose={() => setCreating(false)} />
      ) : (
        <button onClick={() => setCreating(true)} className="btn-ghost inline-flex items-center gap-1 text-sm text-teal-700">
          <Plus size={14} /> シーケンスを作成
        </button>
      ))}

      {sequences.length === 0 && !creating && <p className="text-sm text-ink/45">まだシーケンスがありません。</p>}

      <div className="space-y-2">
        {sequences.map((s) =>
          editingId === s.id ? (
            <SequenceForm key={s.id} seq={s} templates={templates} onClose={() => setEditingId(null)} />
          ) : (
            <div key={s.id} className={`rounded-xl border p-4 ${s.status === "active" ? "border-black/[0.06]" : "border-black/[0.04] bg-mist-soft/20 opacity-70"}`}>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-semibold text-sm text-ink/90">{s.name}</span>
                <span className="pill text-[10px] bg-ink/[0.06] text-ink/55">{s.steps.length}ステップ</span>
                {s.status !== "active" && <span className="pill text-[10px] bg-ink/10 text-ink/50">アーカイブ</span>}
                {canEdit && (
                  <span className="ml-auto flex items-center gap-1">
                    <button onClick={() => setEditingId(s.id)} className="text-ink/40 hover:text-teal-600 p-1" title="編集"><Pencil size={14} /></button>
                    <form action={archiveSequenceAction} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="to" value={s.status === "active" ? "archived" : "active"} />
                      <button type="submit" className="text-ink/40 hover:text-ink/70 p-1" title={s.status === "active" ? "アーカイブ" : "有効化"}>
                        {s.status === "active" ? <Archive size={14} /> : <RotateCcw size={14} />}
                      </button>
                    </form>
                  </span>
                )}
              </div>
              {s.description && <p className="text-xs text-ink/55 mb-1">{s.description}</p>}
              <p className="text-xs text-ink/50">
                {s.steps.map((st, i) => `#${i + 1} ${st.wait_days}日後`).join(" → ")}
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
