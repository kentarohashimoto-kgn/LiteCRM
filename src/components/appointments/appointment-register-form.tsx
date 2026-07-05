"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { registerAppointmentAction } from "@/server/actions/appointments";
import { searchAccountsAction, type PickOption } from "@/server/actions/activities";
import { cn } from "@/lib/utils";

interface Option { id: string; name: string; }
interface BookingLink { id: string; label: string; url: string; }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AppointmentRegisterForm({
  owners,
  products,
  sources,
  bookingLinks,
}: {
  owners: Option[];
  products: Option[];
  sources: Option[];
  bookingLinks: BookingLink[];
}) {
  // 顧客(既存検索 or 新規)
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [account, setAccount] = useState<PickOption | null>(null);
  const [newCompany, setNewCompany] = useState("");
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<PickOption[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 担当者
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");

  // アポ
  const [owner, setOwner] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("");
  const [product, setProduct] = useState("");
  const [source, setSource] = useState("");
  const [preInfo, setPreInfo] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ opportunityId: string; accountName: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => setOpts(await searchAccountsAction(q)), 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open]);

  // 選択中の営業担当に一致しそうな予約URL(担当名がラベルに含まれる)を先頭に
  const ownerName = owners.find((o) => o.id === owner)?.name ?? "";
  const sortedLinks = [...bookingLinks].sort((a, b) => {
    const am = ownerName && (a.label.includes(ownerName) || ownerName.includes(a.label)) ? 0 : 1;
    const bm = ownerName && (b.label.includes(ownerName) || ownerName.includes(b.label)) ? 0 : 1;
    return am - bm;
  });

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await registerAppointmentAction({
      accountId: mode === "existing" ? (account?.id ?? null) : null,
      newCompanyName: mode === "new" ? newCompany : null,
      contactName: cName || null,
      contactTitle: cTitle || null,
      contactPhone: cPhone || null,
      contactEmail: cEmail || null,
      ownerUserId: owner,
      date,
      time: time || null,
      productId: product || null,
      leadSourceId: source || null,
      preInfo: preInfo || null,
    });
    setSaving(false);
    if (res.ok) setDone({ opportunityId: res.opportunityId, accountName: res.accountName });
    else setError(res.error);
  }

  function resetForNext() {
    setDone(null); setAccount(null); setNewCompany(""); setQ("");
    setCName(""); setCTitle(""); setCPhone(""); setCEmail("");
    setDate(todayStr()); setTime(""); setPreInfo("");
    // 営業担当・商材・流入経路は連続登録で使い回すことが多いため維持
  }

  if (done) {
    return (
      <div className="card card-pad max-w-xl text-center space-y-4">
        <CheckCircle2 size={40} className="mx-auto text-teal-primary" />
        <div>
          <div className="text-lg font-bold text-ink">アポを登録しました</div>
          <div className="text-sm text-ink/60 mt-1">{done.accountName} ／ {date}{time ? ` ${time}` : ""}（担当: {ownerName}）</div>
          <div className="text-xs text-ink/45 mt-1">案件（ヨミ: 4.アポ）としてカレンダー・案件一覧に反映されました。</div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={resetForNext} className="btn-accent">続けてアポを登録</button>
          <Link href={`/app/opportunities/${done.opportunityId}`} className="btn-ghost">案件を開く</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      <div className="lg:col-span-2 space-y-4">
        {/* 1. 顧客 */}
        <div className="card card-pad space-y-3">
          <div className="text-sm font-semibold text-ink">1. 顧客（会社）</div>
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
            <button type="button" onClick={() => setMode("existing")} className={cn("rounded-lg px-3 py-1.5 font-medium", mode === "existing" ? "bg-teal-primary text-white" : "text-ink/55")}>既存から検索</button>
            <button type="button" onClick={() => setMode("new")} className={cn("rounded-lg px-3 py-1.5 font-medium", mode === "new" ? "bg-teal-primary text-white" : "text-ink/55")}>新規登録</button>
          </div>
          {mode === "existing" ? (
            account ? (
              <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-mist-soft/40 px-3 py-2 text-sm">
                <span className="flex-1">{account.label}</span>
                <button type="button" onClick={() => setAccount(null)} className="text-xs text-ink/40 hover:text-rose-500">変更</button>
              </div>
            ) : (
              <div className="relative">
                <input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="会社名で検索（見つからなければ「新規登録」へ）" className="input" />
                {open && opts.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
                    {opts.map((o) => (
                      <button key={o.id} type="button" onClick={() => { setAccount(o); setOpen(false); setQ(""); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft">
                        {o.label}{o.sub && <span className="text-ink/40 ml-1 text-xs">{o.sub}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="会社名（同名があれば自動で既存に紐づけます）" className="input" />
          )}
          <div className="grid grid-cols-2 gap-3">
            <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="担当者名（任意）" className="input" />
            <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="役職（任意）" className="input" />
            <input value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="電話（任意）" className="input" />
            <input value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="メール（任意）" className="input" />
          </div>
        </div>

        {/* 2. アポ */}
        <div className="card card-pad space-y-3 border-teal-primary/30">
          <div className="text-sm font-semibold text-teal-deep">2. アポ（初回商談の予定）</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">営業担当 *</label>
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className="input">
                <option value="">選択してください</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">アポ日 *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">開始時間</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">商材（任意）</label>
              <select value={product} onChange={(e) => setProduct(e.target.value)} className="input">
                <option value="">—</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">流入経路（任意）</label>
              <select value={source} onChange={(e) => setSource(e.target.value)} className="input">
                <option value="">—</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">事前情報（課題・温度感・架電メモ）</label>
            <textarea value={preInfo} onChange={(e) => setPreInfo(e.target.value)} rows={3} placeholder="架電で把握した課題・関心・注意点。案件の「事前リサーチ」に保存され、営業担当が商談前に確認できます" className="input" />
          </div>
        </div>

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</div>}
        <button type="button" onClick={submit} disabled={saving} className={cn("btn-accent", saving && "opacity-50")}>
          {saving ? "登録中…" : "アポを登録（案件を作成）"}
        </button>
      </div>

      {/* 予約URL(日程調整しながら開ける) */}
      <div className="card card-pad space-y-2">
        <div className="text-sm font-semibold text-ink">日程調整（各担当の予約URL）</div>
        <p className="text-[11px] text-ink/45">お客様と通話しながら担当の空き枠を確認できます。営業担当を選ぶと該当URLが先頭に並びます。</p>
        <ul className="space-y-1.5">
          {sortedLinks.map((b) => {
            const match = ownerName && (b.label.includes(ownerName) || ownerName.includes(b.label));
            return (
              <li key={b.id}>
                <a href={b.url} target="_blank" rel="noopener noreferrer"
                  className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                    match ? "border-teal-primary bg-teal-light/40 text-teal-deep" : "border-black/10 text-ink/60 hover:bg-mist-soft")}>
                  {b.label} <ExternalLink size={12} className="ml-auto opacity-50" />
                </a>
              </li>
            );
          })}
          {sortedLinks.length === 0 && <li className="text-xs text-ink/40">予約URLは設定画面で登録できます</li>}
        </ul>
      </div>
    </div>
  );
}
