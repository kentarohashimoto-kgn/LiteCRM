"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Check } from "lucide-react";
import { searchContactsWithEmailAction, type ContactPick } from "@/server/actions/email";
import { searchOpportunitiesAction, type PickOption } from "@/server/actions/activities";
import { enrollSequenceAction } from "@/server/actions/sequences";
import { isValidEmail } from "@/lib/email";

/**
 * WO-21 案件/担当者をシーケンスへ投入するパネル(F-101b)。
 * 担当者を選ぶと宛先が自動入力。任意で案件に紐付け(停止条件のヨミ判定に使う)。
 */
export function EnrollPanel({ sequences }: { sequences: { id: string; name: string }[] }) {
  const router = useRouter();
  const [seqId, setSeqId] = useState(sequences[0]?.id ?? "");
  const [contact, setContact] = useState<ContactPick | null>(null);
  const [opp, setOpp] = useState<PickOption | null>(null);
  const [toAddr, setToAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onEnroll() {
    setError(null);
    if (!seqId) { setError("シーケンスを選択してください"); return; }
    if (!isValidEmail(toAddr)) { setError("宛先メールアドレスを正しく入力してください"); return; }
    setBusy(true);
    const res = await enrollSequenceAction({
      sequenceId: seqId,
      contactId: contact?.id ?? null,
      accountId: contact?.account_id ?? null,
      opportunityId: opp?.id ?? null,
      toAddr,
    });
    setBusy(false);
    if (res.ok) { setDone(true); setContact(null); setOpp(null); setToAddr(""); router.refresh(); setTimeout(() => setDone(false), 2500); }
    else setError(res.error);
  }

  return (
    <div className="rounded-xl border border-black/[0.06] p-4 space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink/60 mb-1">シーケンス</label>
          <select value={seqId} onChange={(e) => setSeqId(e.target.value)} className="input">
            {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <ContactSearch onPick={(c) => { setContact(c); if (c?.email) setToAddr(c.email); }} value={contact} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink/60 mb-1">宛先メール</label>
          <input value={toAddr} onChange={(e) => setToAddr(e.target.value)} placeholder="taro@example.com" className="input" />
        </div>
        <OpportunitySearch onPick={setOpp} value={opp} />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={onEnroll} disabled={busy || done} className="btn-accent inline-flex items-center gap-1 text-sm disabled:opacity-60">
          {done ? <><Check size={14} /> 投入しました</> : <><UserPlus size={14} /> {busy ? "投入中…" : "シーケンスに投入"}</>}
        </button>
        <span className="text-xs text-ink/40">案件を紐付けると受注/失注/アポ化で自動停止します。</span>
      </div>
    </div>
  );
}

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
      <label className="block text-xs font-medium text-ink/60 mb-1">担当者(任意)</label>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-mist-soft/40 px-3 py-2 text-sm">
          <span className="flex-1 truncate">{value.name}{value.account_name && <span className="text-ink/40 ml-1">{value.account_name}</span>}</span>
          <button type="button" onClick={() => onPick(null)} className="text-xs text-ink/40 hover:text-rose-500">変更</button>
        </div>
      ) : (
        <>
          <input value={q} placeholder="担当者名で検索" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} className="input" />
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
      <label className="block text-xs font-medium text-ink/60 mb-1">案件に紐付け(任意・自動停止用)</label>
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
