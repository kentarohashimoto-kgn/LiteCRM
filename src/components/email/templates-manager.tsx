"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMAIL_CATEGORY_LABEL, EMAIL_TEMPLATE_VARS } from "@/lib/email";
import {
  createEmailTemplateAction,
  updateEmailTemplateAction,
  deleteEmailTemplateAction,
} from "@/server/actions/email";
import type { EmailTemplate } from "@/app/app/email/templates/page";

const CATEGORIES = ["thanks", "material", "schedule", "followup", "other"];

function VarHelp() {
  return (
    <p className="text-[11px] text-ink/45 mt-1">
      使える変数: {EMAIL_TEMPLATE_VARS.map((v) => `{${v.key}}=${v.label}`).join(" / ")}
    </p>
  );
}

function TemplateForm({
  template,
  action,
  onClose,
}: {
  template?: EmailTemplate;
  action: (fd: FormData) => void;
  onClose?: () => void;
}) {
  return (
    <form action={action} className="rounded-xl border border-teal-200 bg-teal-50/30 p-4 space-y-2">
      {template && <input type="hidden" name="id" value={template.id} />}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-ink/60 mb-1">名称<span className="text-rose-500">*</span></label>
          <input name="name" defaultValue={template?.name ?? ""} className="input" placeholder="例: 商談お礼" required />
        </div>
        <div className="w-40">
          <label className="block text-xs font-medium text-ink/60 mb-1">カテゴリ</label>
          <select name="category" defaultValue={template?.category ?? "other"} className="input">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{EMAIL_CATEGORY_LABEL[c] ?? c}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">件名</label>
        <input name="subject_tmpl" defaultValue={template?.subject_tmpl ?? ""} className="input" placeholder="本日はありがとうございました（{company}）" />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">本文</label>
        <textarea name="body_tmpl" defaultValue={template?.body_tmpl ?? ""} rows={7} className="input font-mono text-xs" placeholder="{contact} 様&#10;&#10;本日はありがとうございました。" />
        <VarHelp />
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton className="btn-accent text-sm">{template ? "更新する" : "作成する"}</SubmitButton>
        {onClose && (
          <button type="button" onClick={onClose} className="btn-ghost text-sm text-ink/50 inline-flex items-center gap-1">
            <X size={14} /> キャンセル
          </button>
        )}
      </div>
    </form>
  );
}

export function TemplatesManager({ templates, canEdit }: { templates: EmailTemplate[]; canEdit: boolean }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {canEdit && (
        creating ? (
          <TemplateForm action={createEmailTemplateAction} onClose={() => setCreating(false)} />
        ) : (
          <button onClick={() => setCreating(true)} className="btn-ghost inline-flex items-center gap-1 text-sm text-teal-700">
            <Plus size={14} /> 定型文を追加
          </button>
        )
      )}

      {templates.length === 0 && !creating && (
        <p className="text-sm text-ink/45">定型文がありません。「定型文を追加」で作成できます。</p>
      )}

      <div className="space-y-2">
        {templates.map((t) =>
          editingId === t.id ? (
            <TemplateForm key={t.id} template={t} action={updateEmailTemplateAction} onClose={() => setEditingId(null)} />
          ) : (
            <div key={t.id} className="rounded-xl border border-black/[0.06] p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm text-ink/90">{t.name}</span>
                <span className="pill text-[10px] bg-ink/[0.06] text-ink/55">{EMAIL_CATEGORY_LABEL[t.category] ?? t.category}</span>
                {canEdit && (
                  <span className="ml-auto flex items-center gap-1">
                    <button onClick={() => setEditingId(t.id)} className="text-ink/40 hover:text-teal-600 p-1" title="編集">
                      <Pencil size={14} />
                    </button>
                    <form action={deleteEmailTemplateAction} className="inline">
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="text-ink/40 hover:text-rose-600 p-1" title="削除">
                        <Trash2 size={14} />
                      </button>
                    </form>
                  </span>
                )}
              </div>
              {t.subject_tmpl && <p className="text-xs text-ink/70 mb-1">件名: {t.subject_tmpl}</p>}
              {t.body_tmpl && <p className="text-xs text-ink/50 whitespace-pre-wrap line-clamp-3">{t.body_tmpl}</p>}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
