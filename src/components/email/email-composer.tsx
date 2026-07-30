"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ExternalLink, Check, Send } from "lucide-react";
import Link from "next/link";
import { renderEmailTemplate, buildGmailComposeUrl, EMAIL_CATEGORY_LABEL, isValidEmail } from "@/lib/email";
import {
  searchContactsWithEmailAction,
  logEmailAction,
  type ContactPick,
} from "@/server/actions/email";
import { sendEmailViaSmtpAction } from "@/server/actions/mail-send";
import { scheduleEmailAction } from "@/server/actions/mail-schedule";
import { SchedulePicker } from "@/components/email/schedule-picker";
import { formatJstSchedule } from "@/lib/schedule";
import { searchOpportunitiesAction, type PickOption } from "@/server/actions/activities";
import type { EmailTemplate } from "@/app/app/email/templates/page";
import type { SenderVars } from "@/lib/sender";

export interface ComposerInitial {
  senderName: string;
  /** 差出人依存の差し込み値({sender_last}/{sender_email}/{signature})。サーバーで解決済み */
  senderVars?: SenderVars;
  contact?: { id: string; name: string; email: string | null };
  opportunity?: { id: string; name: string };
  accountId?: string | null;
  company?: string | null;
}

export function EmailComposer({ templates, initial, hasMailAccount }: { templates: EmailTemplate[]; initial: ComposerInitial; hasMailAccount: boolean }) {
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
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // 予約送信(Gmailの「送信日時を設定」相当)。null=即時送信
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  // 配信停止リンク(既定OFF)。広告宣伝が主目的の内容のときだけONにする
  const [unsubFooter, setUnsubFooter] = useState(false);
  const [scheduled, setScheduled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const company = contact?.account_name ?? initial.company ?? null;

  const vars = useMemo(
    () => ({
      contact: contact?.name ?? null,
      company: company,
      opportunity: opportunity?.label ?? null,
      sender: initial.senderName,
      ...(initial.senderVars ?? {}),
    }),
    [contact, company, opportunity, initial.senderName, initial.senderVars],
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

  async function onSend() {
    setError(null);
    if (!isValidEmail(toAddr)) { setError("宛先メールアドレスを正しく入力してください"); return; }
    if (!subject.trim() && !body.trim()) { setError("件名または本文を入力してください"); return; }
    setSending(true);
    const common = {
      contactId: contact?.id ?? null,
      accountId: contact?.account_id ?? initial.accountId ?? null,
      opportunityId: opportunity?.id ?? null,
      templateId,
      toAddr,
      subject,
      body,
      unsubscribeFooter: unsubFooter,
    };
    // 送信日時の指定があれば予約(cronが指定時刻に本人アカウントで送信する)
    if (scheduleAt) {
      const res = await scheduleEmailAction({ ...common, scheduledAtIso: scheduleAt, unsubscribeFooter: unsubFooter });
      setSending(false);
      if (res.ok) { setScheduled(scheduleAt); setSent(true); router.refresh(); }
      else setError(res.error);
      return;
    }
    const res = await sendEmailViaSmtpAction(common);
    setSending(false);
    if (res.ok) { setSent(true); setLogged(true); router.refresh(); }
    else setError(res.error);
  }

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

      {error && <p className="text-sm text-rose-600 whitespace-pre-wrap">{error}</p>}
      {sent && !scheduled && <p className="text-sm text-emerald-700 inline-flex items-center gap-1"><Check size={14} /> 送信しました。開封・クリックは送信履歴で確認できます。</p>}
      {scheduled && (
        <p className="text-sm text-teal-deep inline-flex items-center gap-1">
          <Check size={14} /> {formatJstSchedule(scheduled)} に送信予約しました。
          <Link href="/app/email/scheduled" className="underline">予約一覧で確認・変更</Link>
        </p>
      )}

      {hasMailAccount ? (
        <>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={onSend} disabled={sending || sent} className="btn-accent inline-flex items-center gap-1 text-sm disabled:opacity-60">
              <Send size={14} /> {sent ? (scheduled ? "予約済み" : "送信済み") : sending ? (scheduleAt ? "予約中…" : "送信中…") : scheduleAt ? "この日時に送信予約する" : "送信する（計測あり）"}
            </button>
            {!sent && <SchedulePicker value={scheduleAt} onChange={setScheduleAt} disabled={sending} />}
            <a href={gmailUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/60">
              <ExternalLink size={14} /> かわりにGmailで開く
            </a>
          </div>
          {!sent && (
            <label className="flex items-start gap-2 text-xs text-ink/60 cursor-pointer">
              <input type="checkbox" checked={unsubFooter} onChange={(e) => setUnsubFooter(e.target.checked)} className="accent-teal-primary mt-0.5" />
              <span>
                配信停止リンクを本文末尾に付ける
                <span className="block text-ink/40">
                  個別の業務連絡（アポ調整・お礼・資料送付など）では<b>不要</b>です。サービス紹介・セミナー勧誘など<b>広告宣伝が主目的</b>の内容を送る場合はONにしてください（特定電子メール法の表示義務）。
                </span>
              </span>
            </label>
          )}
          <p className="text-xs text-ink/40">
            「送信する」はご自身のメールアカウント経由で送信し、開封（近似）とリンククリック（どの資料か）を計測します。送信控えはご自身の[送信済み]にも残ります。
            {" "}「送信日時を指定」で予約すると、指定時刻に同じ方法で自動送信されます（送信前ならキャンセル・日時変更が可能）。
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a href={gmailUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className="btn-accent inline-flex items-center gap-1 text-sm">
              <ExternalLink size={14} /> Gmailで開く
            </a>
            <button onClick={onLog} disabled={saving || logged} className="btn-primary inline-flex items-center gap-1 text-sm disabled:opacity-60">
              {logged ? <><Check size={14} /> 記録済み</> : <><Mail size={14} /> {saving ? "記録中…" : "記録する"}</>}
            </button>
            {opened && !logged && <span className="text-xs text-ink/45">送信したら「記録する」でタイムラインに残せます。</span>}
          </div>
          <p className="text-xs text-ink/40">
            開封・クリックを計測して送りたい場合は <Link href="/app/email/account" className="text-teal-700 underline">メール送信アカウントを接続</Link> してください（GWS/Zoho対応）。未接続時は「Gmailで開く」→「記録する」の手動フローになります。
          </p>
        </>
      )}
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
