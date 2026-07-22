"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Phone, Mail, Pencil, Plus, Star, Trash2, Loader2, X, Building2, UserPlus, ChevronDown } from "lucide-react";
import { createContactAction, updateContactAction, deleteContactAction, setAccounterAction, promoteLeadToContactAction, type ContactInput } from "@/server/actions/contacts";
import { cn } from "@/lib/utils";

export interface PanelContact {
  id: string;
  name: string;
  department?: string | null;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  decision_role?: string | null;
}

export interface LeadCandidate {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  source?: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  decision_maker: "意思決定者",
  influencer: "影響者",
  user: "利用者",
  referrer: "紹介者",
};
const ROLE_OPTIONS = [
  { value: "", label: "役割 未設定" },
  { value: "decision_maker", label: "意思決定者" },
  { value: "influencer", label: "影響者" },
  { value: "user", label: "利用者" },
  { value: "referrer", label: "紹介者" },
];

/** 顧客のアカウンター(窓口担当者)情報の表示＋追加・変更パネル。 */
export function AccounterPanel({
  opportunityId,
  accountId,
  accountName,
  accountIndustry,
  accountArea,
  accountHref,
  contacts,
  accounterId,
  leadCandidates = [],
  canEdit = true,
}: {
  opportunityId: string;
  accountId: string;
  accountName: string;
  accountIndustry?: string | null;
  accountArea?: string | null;
  accountHref: string;
  contacts: PanelContact[];
  accounterId: string | null;
  leadCandidates?: LeadCandidate[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<null | "add" | { editId: string }>(null);
  const [error, setError] = useState("");
  const [showAllLeads, setShowAllLeads] = useState(false);

  const accounter = contacts.find((c) => c.id === accounterId) ?? null;
  const others = contacts.filter((c) => c.id !== accounterId);
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

  const setAccounter = (contactId: string | null) => run(() => setAccounterAction({ opportunityId, contactId }));
  const removeContact = (id: string) => {
    if (!window.confirm("この担当者を削除しますか？")) return;
    run(() => deleteContactAction({ id, opportunityId, accountId }));
  };
  const promoteLead = (leadId: string, setAsAccounter: boolean) =>
    run(() => promoteLeadToContactAction({ leadId, accountId, opportunityId, setAccounter: setAsAccounter }));

  return (
    <div className="space-y-3 text-sm">
      {/* 会社 */}
      <div>
        <Link href={accountHref} className="inline-flex items-center gap-1 font-semibold text-teal-deep hover:underline">
          <Building2 size={14} /> {accountName}
        </Link>
        <div className="mt-0.5 text-xs text-ink/50">{[accountIndustry, accountArea].filter(Boolean).join(" ・ ") || "業種・エリア 未登録"}</div>
      </div>

      {/* アカウンター(窓口) */}
      {mode && typeof mode === "object" && accounter && mode.editId === accounter.id ? (
        <ContactForm
          title="アカウンターを編集"
          initial={accounter}
          pending={pending}
          onCancel={() => setMode(null)}
          onSubmit={(v) => run(() => updateContactAction({ ...v, id: accounter.id, opportunityId, accountId }), () => setMode(null))}
        />
      ) : accounter ? (
        <ContactCard
          c={accounter}
          isAccounter
          canEdit={canEdit}
          pending={pending}
          onEdit={() => setMode({ editId: accounter.id })}
          onRemove={() => removeContact(accounter.id)}
        />
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-accent-orange">
          アカウンター（顧客側の窓口担当者）が未設定です。下から担当者を追加、または既存の担当者を選んで設定してください。
        </div>
      )}

      {/* アカウンター選択(既存の担当者から) */}
      {canEdit && contacts.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink/45 shrink-0">窓口に設定</span>
          <select
            value={accounterId ?? ""}
            disabled={pending}
            onChange={(e) => setAccounter(e.target.value || null)}
            className="input min-w-0 flex-1 py-1 text-xs"
            aria-label="アカウンターを選択"
          >
            <option value="">アカウンター未設定</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{[c.department, c.title, c.name].filter(Boolean).join("／")}</option>
            ))}
          </select>
        </div>
      )}

      {/* リード候補（名刺・リードから窓口を選ぶ） */}
      {leadCandidates.length > 0 && (
        <div className="space-y-1.5 border-t border-black/[0.05] pt-2.5">
          <div className="text-[11px] font-medium text-ink/55">
            リード候補（{leadCandidates.length}）
            <span className="ml-1 font-normal text-ink/35">名刺・リードから窓口担当者を選べます</span>
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
                    <div className="flex shrink-0 flex-col items-stretch gap-1">
                      <button type="button" onClick={() => promoteLead(l.id, true)} disabled={pending} className="inline-flex items-center justify-center gap-1 rounded-lg bg-teal-primary px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-deep disabled:opacity-50" title="この人を窓口(アカウンター)に設定">
                        <Star size={11} /> 窓口に設定
                      </button>
                      <button type="button" onClick={() => promoteLead(l.id, false)} disabled={pending} className="inline-flex items-center justify-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-[11px] text-ink/60 hover:bg-mist-soft disabled:opacity-50" title="担当者として追加(窓口にはしない)">
                        <UserPlus size={11} /> 追加
                      </button>
                    </div>
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

      {/* 他の担当者 */}
      {others.length > 0 && (
        <div className="space-y-2 border-t border-black/[0.05] pt-2.5">
          <div className="text-[11px] font-medium text-ink/45">その他の担当者（{others.length}）</div>
          {others.map((c) =>
            mode && typeof mode === "object" && mode.editId === c.id ? (
              <ContactForm
                key={c.id}
                title="担当者を編集"
                initial={c}
                pending={pending}
                onCancel={() => setMode(null)}
                onSubmit={(v) => run(() => updateContactAction({ ...v, id: c.id, opportunityId, accountId }), () => setMode(null))}
              />
            ) : (
              <ContactCard
                key={c.id}
                c={c}
                canEdit={canEdit}
                pending={pending}
                onEdit={() => setMode({ editId: c.id })}
                onRemove={() => removeContact(c.id)}
                onSetAccounter={() => setAccounter(c.id)}
              />
            ),
          )}
        </div>
      )}

      {contacts.length === 0 && !mode && (
        <p className="text-xs text-ink/40">担当者が未登録です。下の「＋ 担当者を追加」から窓口担当者を登録できます。</p>
      )}

      {/* 追加 */}
      {canEdit && (
        mode === "add" ? (
          <ContactForm
            title="担当者を追加"
            pending={pending}
            showSetAccounter={!accounter}
            onCancel={() => setMode(null)}
            onSubmit={(v, setAsAccounter) =>
              run(() => createContactAction({ ...v, accountId, opportunityId, setAccounter: setAsAccounter }), () => setMode(null))
            }
          />
        ) : (
          <button
            type="button"
            onClick={() => { setError(""); setMode("add"); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-teal-deep hover:bg-mist-soft"
          >
            <Plus size={14} /> 担当者を追加
          </button>
        )
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/** 担当者1件の詳細カード表示。 */
function ContactCard({
  c,
  isAccounter,
  canEdit,
  pending,
  onEdit,
  onRemove,
  onSetAccounter,
}: {
  c: PanelContact;
  isAccounter?: boolean;
  canEdit: boolean;
  pending: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onSetAccounter?: () => void;
}) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", isAccounter ? "border-teal-primary/25 bg-teal-light/40" : "border-black/[0.06] bg-white")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {isAccounter && <span className="pill bg-teal-primary text-white text-[10px] font-bold">アカウンター</span>}
            <span className={cn("font-semibold", isAccounter && "text-teal-deep")}>{c.name}</span>
            {c.decision_role && ROLE_LABEL[c.decision_role] && (
              <span className="pill bg-black/[0.05] text-ink/55 text-[10px]">{ROLE_LABEL[c.decision_role]}</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-ink/55">
            {[c.department, c.title].filter(Boolean).join("・") || <span className="text-ink/35">部署・役職 未登録</span>}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            {onSetAccounter && (
              <button type="button" onClick={onSetAccounter} disabled={pending} className="rounded p-1 text-ink/35 hover:text-teal-deep" title="この人を窓口(アカウンター)に設定">
                <Star size={13} />
              </button>
            )}
            <button type="button" onClick={onEdit} disabled={pending} className="rounded p-1 text-ink/35 hover:text-teal-deep" title="編集">
              <Pencil size={13} />
            </button>
            <button type="button" onClick={onRemove} disabled={pending} className="rounded p-1 text-ink/30 hover:text-rose-600" title="削除">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      {(c.phone || c.email || c.notes) && (
        <div className="mt-2 space-y-1 border-t border-black/[0.05] pt-2 text-xs">
          {c.phone && (
            <div className="flex items-center gap-1.5 text-ink/70"><Phone size={12} className="text-ink/40" /><a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a></div>
          )}
          {c.email && (
            <div className="flex items-center gap-1.5 text-ink/70"><Mail size={12} className="text-ink/40" /><a href={`mailto:${c.email}`} className="truncate hover:underline">{c.email}</a></div>
          )}
          {c.notes && <div className="whitespace-pre-wrap text-ink/60"><span className="text-ink/35">メモ：</span>{c.notes}</div>}
        </div>
      )}
    </div>
  );
}

/** 担当者の追加/編集フォーム。 */
function ContactForm({
  title,
  initial,
  pending,
  showSetAccounter,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: PanelContact;
  pending: boolean;
  showSetAccounter?: boolean;
  onSubmit: (v: ContactInput, setAsAccounter: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [title2, setTitle2] = useState(initial?.title ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [decisionRole, setDecisionRole] = useState(initial?.decision_role ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [setAsAccounter, setSetAsAccounter] = useState(false);

  const submit = () => {
    if (!name.trim() || pending) return;
    onSubmit({ name, department, title: title2, phone, email, notes, decisionRole }, setAsAccounter);
  };

  return (
    <div className="space-y-2 rounded-lg border border-teal-primary/25 bg-white px-3 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink/70">{title}</span>
        <button type="button" onClick={onCancel} className="text-ink/35 hover:text-ink" aria-label="キャンセル"><X size={14} /></button>
      </div>
      <div>
        <label className="label">氏名 *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="例：山田 太郎" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">部署</label><input value={department} onChange={(e) => setDepartment(e.target.value)} className="input" placeholder="例：情報システム部" /></div>
        <div><label className="label">役職</label><input value={title2} onChange={(e) => setTitle2(e.target.value)} className="input" placeholder="例：部長" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">電話番号</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="例：03-1234-5678" /></div>
        <div><label className="label">役割</label>
          <select value={decisionRole} onChange={(e) => setDecisionRole(e.target.value)} className="input">
            {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div><label className="label">メールアドレス</label><input value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="例：taro@example.co.jp" /></div>
      <div><label className="label">メモ（どんな人か？）</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" placeholder="人柄・関係性・決裁の温度感・注意点など" /></div>
      {showSetAccounter && (
        <label className="flex items-center gap-1.5 text-xs text-ink/70">
          <input type="checkbox" checked={setAsAccounter} onChange={(e) => setSetAsAccounter(e.target.checked)} className="h-3.5 w-3.5 accent-teal-deep" />
          この担当者を窓口（アカウンター）に設定する
        </label>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <button type="button" onClick={submit} disabled={!name.trim() || pending} className="btn-primary text-xs">
          {pending ? <Loader2 size={13} className="animate-spin" /> : null} 保存
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-ink/50 hover:text-ink">キャンセル</button>
      </div>
    </div>
  );
}
