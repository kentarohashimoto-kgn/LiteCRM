"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { updateBusinessCardAction, type CardEditInput } from "@/server/actions/business-cards";
import type { BusinessCard } from "@/lib/types";

const FIELDS: { key: keyof CardEditInput; label: string; type?: string; span2?: boolean; required?: boolean }[] = [
  { key: "company_name", label: "会社名", span2: true, required: true },
  { key: "full_name", label: "氏名", required: true },
  { key: "title", label: "役職" },
  { key: "department", label: "部署名", span2: true },
  { key: "email", label: "e-mail", type: "email" },
  { key: "exchanged_on", label: "名刺交換日", type: "date" },
  { key: "postal_code", label: "郵便番号" },
  { key: "address", label: "住所", span2: true },
  { key: "tel_company", label: "TEL会社" },
  { key: "tel_department", label: "TEL部門" },
  { key: "tel_direct", label: "TEL直通" },
  { key: "fax", label: "Fax" },
  { key: "mobile_phone", label: "携帯電話" },
  { key: "url", label: "URL" },
];

/** スキャン誤り修正用の編集フォーム。保存すると変更履歴（監査ログ）に自動記録される。 */
export function CardEditForm({ card }: { card: BusinessCard }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [values, setValues] = useState<CardEditInput>({
    company_name: card.company_name ?? "",
    department: card.department ?? "",
    title: card.title ?? "",
    full_name: card.full_name ?? "",
    email: card.email ?? "",
    postal_code: card.postal_code ?? "",
    address: card.address ?? "",
    tel_company: card.tel_company ?? "",
    tel_department: card.tel_department ?? "",
    tel_direct: card.tel_direct ?? "",
    fax: card.fax ?? "",
    mobile_phone: card.mobile_phone ?? "",
    url: card.url ?? "",
    exchanged_on: card.exchanged_on ?? "",
    memo: card.memo ?? "",
  });

  const set = (k: keyof CardEditInput, v: string) => setValues((p) => ({ ...p, [k]: v }));

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await updateBusinessCardAction({ cardId: card.id, fields: values });
      setMsg(r.ok ? { ok: true, text: "保存しました" } : { ok: false, text: r.error ?? "保存に失敗しました" });
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <label key={f.key} className={`block ${f.span2 ? "sm:col-span-2" : ""}`}>
            <span className="block text-[11px] text-ink/50 mb-1">
              {f.label}
              {f.required && <span className="text-rose-500 ml-0.5">*</span>}
            </span>
            <input
              type={f.type ?? "text"}
              value={(values[f.key] as string) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
          </label>
        ))}
        <label className="block sm:col-span-2">
          <span className="block text-[11px] text-ink/50 mb-1">メモ</span>
          <textarea
            value={values.memo ?? ""}
            onChange={(e) => set("memo", e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className="btn-primary disabled:opacity-50">
          <Save size={15} className="mr-1 inline" />
          {pending ? "保存中…" : "保存"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-teal-deep" : "text-rose-600"}`}>{msg.text}</span>}
        <span className="text-xs text-ink/40">変更は履歴に記録されます。再取込しても編集内容は上書きされません。</span>
      </div>
    </div>
  );
}
