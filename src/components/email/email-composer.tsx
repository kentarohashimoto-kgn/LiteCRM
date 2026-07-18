"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ExternalLink, Check } from "lucide-react";
import { renderEmailTemplate, buildGmailComposeUrl, EMAIL_CATEGORY_LABEL, isValidEmail } from "@/lib/email";
import {
  searchContactsWithEmailAction,
  logEmailAction,
  type ContactPick,
} from "@/server/actions/email";
import { searchOpportunitiesAction, type PickOption } from "@/server/actions/activities";
import type { EmailTemplate } from "@/app/app/email/templates/page";

export interface ComposerInitial {
  senderName: string;
  contact?: { id: string; name: string; email: string | null };
  opportunity?: { id: string; name: string };
  accountId?: string | null;
  company?: string | null;
}

export function EmailComposer({ templates, initial }: { templates: EmailTemplate[]; initial: ComposerInitial }) {
  const router = useRouter();
  const [contact, setContact] = useState<ContactPick | null>(
    initial.contact ? { id: initial.contact.id, name: initial.contact.name, email: initial.contact.email, account_id: initial.accountId ?? null, account_name: initial.company ?? null } : null,
  );
  const [opportunity, setOpportunity] = useState<PickOption | null>(
    initial.opportunity ? { id: initial.opportunity.id, label: initial.opportunity.name } : null,
  );
  const [toAddr, setToAddr] = useState(initial.contact?.email ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logged, setLogged] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = contact?.account_name ?? initial.company ?? null;

  const vars = useMemo(
    () => ({
      contact: contact?.name ?? null,
      company: company,
      opportunity: opportunity?.label ?? null,
      sender: initial.senderName,
    }),
    [contact, company, opportunity, initial.senderName],
  );

  /** 定型文を選んだら件名・本文に差し込む(既入力を上書き)。 */
  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    setTemplateId(id || null);
    if (!t) return;
    setSubject(renderEmailTemplate(t.subject_tmpl, vars));
    setBody(renderEmailTemplate(t.body_tmpl, vars));
    setLogged(false);
    setOpened(false);
  }

  const gmailUrl = buildGmailComposeUrl({ to: toAddr, subject, body });

  async function onLog() {
    setError(null);
    if (!subject.trim() && !body.trim()) { setError("件名または本文を入力してください"); return; }
    setSaving(true);
    const res = await logEmailAction({
      contactId: contact?.id ?? null,
      accountId: contact?.account_id ?? initial.accountId ?? null,
      opportunityId: opportunity?.id ?? null,
      templateId,
      toAddr: toAddr || null,
      subject,
      body,
    });
    setSaving(false);
    if (res.ok) {
      setLogged(true);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ContactSearch value={contact} onPick={(c) => { setContact(c); if (c?.email) setToAddr(c.email); }} />
        <OpportunitySearch value={opportunity} onPick={setOpportunity} />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">宛先メール</label>
        <input value={toAddr} onChange={(e) => setToAddr(e.target.value)} placeholder="taro@example.com" className="input" />
        {toAddr && !isValidEmail(toAddr) && <p className="text-[11px] text-amber-600 mt-1">メールアドレスの形式をご確認ください。</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">定型文</label>
        <select value={templateId ?? ""} onChange={(e) => applyTemplate(e.target.value)} className="input">
          <option value="">（定型文を選択して差し込む）</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{EMAIL_CATEGORY_LABEL[t.category] ?? t.category}｜{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">件名</label>
        <input value={subject} onChange={(e) => { setSubject(e.target.value); setLogged(false); }} className="input" />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink/60 mb-1">本文</label>
        <textarea value={body} onChange={(e) => { setBody(e.target.value); setLogged(false); }} rows={12} className="input text-sm" />
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <a
          href={gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpened(true)}
          className="btn-accent inline-flex items-center gap-1 text-sm"
        >
          <ExternalLink size={14} /> Gmailで開く
        </a>
        <button onClick={onLog} disabled={saving || logged} className="btn-primary inline-flex items-center gap-1 text-sm disabled:opacity-60">
          {logged ? <><Check size={14} /> 記録済み</> : <><Mail size={14} /> {saving ? "記録中…" : "記録する"}</>}
        </button>
        {opened && !logged && <span className="text-xs text-ink/45">送信したら「記録する」でタイムラインに残せます。</span>}
      </div>
      <p className="text-xs text-ink/40">
        「Gmailで開く」は Gmail の作成画面を新しいタブで開きます（送信はご自身で確認のうえ実施）。「記録する」で活動タイムライン（メール）と案件に紐づきます。
      </p>
    </div>
  );
}

// ---- 検索セレクト(activity-form と同型の軽量版) ----
function ContactSearch({ value, onPick }: { value: ContactPick | null; onPick: (c: ContactPick | null) => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<ContactPick[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => setOpts(await searchContactsWithEmailAction(q)), 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open]);
  return (
    <div className="relative">
      <label className="block text-xs font-medium text-ink/60 mb-1">担当者(宛先)</label>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-mist-soft/40 px-3 py-2 text-sm">
          <span className="flex-1 truncate">{value.name}{value.account_name && <span className="text-ink/40 ml-1">{value.account_name}</span>}</span>
          <button type="button" onClick={() => onPick(null)} className="text-xs text-ink/40 hover:text-rose-500">変更</button>
        </div>
      ) : (
        <>
          <input value={q} placeholder="担当者名で検索(メールあり)" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} className="input" />
          {open && opts.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
              {opts.map((o) => (
                <button key={o.id} type="button" onClick={() => { onPick(o); setOpen(false); setQ(""); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft">
                  {o.name}<span className="text-ink/40 ml-1 text-xs">{o.account_name ?? ""} {o.email ?? ""}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OpportunitySearch({ value, onPick }: { value: PickOption | null; onPick: (o: PickOption | null) => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<PickOption[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => setOpts(await searchOpportunitiesAction(q)), 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open]);
  return (
    <div className="relative">
      <label className="block text-xs font-medium text-ink/60 mb-1">案件に紐付け(任意)</label>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-mist-soft/40 px-3 py-2 text-sm">
          <span className="flex-1 truncate">{value.label}</span>
          <button type="button" onClick={() => onPick(null)} className="text-xs text-ink/40 hover:text-rose-500">変更</button>
        </div>
      ) : (
        <>
          <input value={q} placeholder="案件名で検索" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} className="input" />
          {open && opts.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
              {opts.map((o) => (
                <button key={o.id} type="button" onClick={() => { onPick(o); setOpen(false); setQ(""); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft">
                  {o.label}{o.sub && <span className="text-ink/40 ml-1 text-xs">{o.sub}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
