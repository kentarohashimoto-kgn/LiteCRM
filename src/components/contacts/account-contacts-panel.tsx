"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Mail, Phone, UserPlus, ChevronDown } from "lucide-react";
import { createContactAction, updateContactAction, deleteContactAction, promoteLeadToContactAction } from "@/server/actions/contacts";
import { ContactForm, ContactCard, type PanelContact, type LeadCandidate } from "./accounter-panel";
import { cn } from "@/lib/utils";

/**
 * 顧客(account)ビューの担当者パネル。複数案件をまたいで担当者を一覧・追加・編集・削除でき、
 * 各担当者が「どの案件の窓口(アカウンター)か」も表示する。リード候補からの登録も可能。
 * ※窓口(アカウンター)の設定は案件単位のため、ここでは表示のみ（設定は各案件の画面で行う）。
 */
export function AccountContactsPanel({
  accountId,
  contacts,
  accounterByContact,
  leadCandidates = [],
  canEdit = true,
}: {
  accountId: string;
  contacts: PanelContact[];
  accounterByContact: Record<string, { id: string; name: string }[]>;
  leadCandidates?: LeadCandidate[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<null | "add" | { editId: string }>(null);
  const [error, setError] = useState("");
  const [showAllLeads, setShowAllLeads] = useState(false);

  const LEAD_PREVIEW = 5;
  const shownLeads = showAllLeads ? leadCandidates : leadCandidates.slice(0, LEAD_PREVIEW);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error ?? "操作に失敗しました"); return; }
      onOk?.();
      router.refresh();
    });
  };

  const removeContact = (id: string) => {
    if (!window.confirm("この担当者を削除しますか？")) return;
    run(() => deleteContactAction({ id, accountId }));
  };
  const promoteLead = (leadId: string) => run(() => promoteLeadToContactAction({ leadId, accountId }));

  return (
    <div className="space-y-3 text-sm">
      {contacts.length === 0 && !mode && (
        <p className="text-xs text-ink/40">担当者が未登録です。下の「＋ 担当者を新規登録」から登録できます。</p>
      )}

      {contacts.length > 0 && (
        <div className="space-y-2">
          {contacts.map((c) =>
            mode && typeof mode === "object" && mode.editId === c.id ? (
              <ContactForm
                key={c.id}
                title="担当者を編集"
                initial={c}
                pending={pending}
                onCancel={() => setMode(null)}
                onSubmit={(v) => run(() => updateContactAction({ ...v, id: c.id, accountId }), () => setMode(null))}
              />
            ) : (
              <ContactCard
                key={c.id}
                c={c}
                canEdit={canEdit}
                pending={pending}
                onEdit={() => setMode({ editId: c.id })}
                onRemove={() => removeContact(c.id)}
                accounterOpps={accounterByContact[c.id]}
              />
            ),
          )}
        </div>
      )}

      {/* リード候補（名刺・リードから担当者を登録） */}
      {leadCandidates.length > 0 && (
        <div className="space-y-1.5 border-t border-black/[0.05] pt-2.5">
          <div className="text-[11px] font-medium text-ink/55">
            リード候補（{leadCandidates.length}）
            <span className="ml-1 font-normal text-ink/35">名刺・リードから担当者を登録できます</span>
          </div>
          <ul className="space-y-1.5">
            {shownLeads.map((l) => (
              <li key={l.id} className="rounded-lg border border-black/[0.06] bg-white px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink/85">{l.name}</span>
                      {l.jobTitle && <span className="pill bg-black/[0.05] text-ink/55 text-[10px]">{l.jobTitle}</span>}
                    </div>
                    {(l.department || l.source) && (
                      <div className="mt-0.5 text-[11px] text-ink/50">{[l.department, l.source].filter(Boolean).join("・")}</div>
                    )}
                    {(l.email || l.phone) && (
                      <div className="mt-1 space-y-0.5 text-[11px]">
                        {l.email && <div className="flex items-center gap-1.5 text-ink/70"><Mail size={11} className="text-ink/40" /><a href={`mailto:${l.email}`} className="truncate hover:underline">{l.email}</a></div>}
                        {l.phone && <div className="flex items-center gap-1.5 text-ink/70"><Phone size={11} className="text-ink/40" /><a href={`tel:${l.phone}`} className="hover:underline">{l.phone}</a></div>}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <button type="button" onClick={() => promoteLead(l.id)} disabled={pending} className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-[11px] text-ink/60 hover:bg-mist-soft disabled:opacity-50" title="担当者として登録">
                      <UserPlus size={11} /> 担当者に追加
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {leadCandidates.length > LEAD_PREVIEW && (
            <button type="button" onClick={() => setShowAllLeads((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-teal-deep hover:underline">
              <ChevronDown size={12} className={cn("transition-transform", showAllLeads && "rotate-180")} />
              {showAllLeads ? "候補をたたむ" : `すべて表示（${leadCandidates.length}）`}
            </button>
          )}
        </div>
      )}

      {/* 追加 */}
      {canEdit && (
        mode === "add" ? (
          <ContactForm
            title="担当者を新規登録"
            pending={pending}
            onCancel={() => setMode(null)}
            onSubmit={(v) => run(() => createContactAction({ ...v, accountId }), () => setMode(null))}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setError(""); setMode("add"); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-teal-deep hover:bg-mist-soft"
          >
            <Plus size={14} /> 担当者を新規登録
          </button>
        )
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
