"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Sparkles } from "lucide-react";
import {
  registerAppointmentAction,
  searchApptLeadsAction,
  getApptLeadDetailAction,
  getAccountSourceAction,
  type ApptLeadHit,
  type ApptLeadDetail,
} from "@/server/actions/appointments";
import { searchAccountsAction, type PickOption } from "@/server/actions/activities";
import { cn } from "@/lib/utils";

interface Option { id: string; name: string; }
interface DetailOption { id: string; lead_source_id: string; name: string; }
interface BookingLink { id: string; label: string; url: string; }
type Mode = "lead" | "existing" | "new";
const DETAIL_FREE = "__free__";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AppointmentRegisterForm({
  owners,
  products,
  sources,
  details,
  bookingLinks,
  currentUserId,
}: {
  owners: Option[];
  products: Option[];
  sources: Option[];
  details: DetailOption[];
  bookingLinks: BookingLink[];
  currentUserId: string;
}) {
  const [mode, setMode] = useState<Mode>("lead");

  // リード検索
  const [lead, setLead] = useState<ApptLeadDetail | null>(null);
  const [leadQ, setLeadQ] = useState("");
  const [leadOpts, setLeadOpts] = useState<ApptLeadHit[]>([]);
  const [leadOpen, setLeadOpen] = useState(false);
  const leadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 既存顧客検索
  const [account, setAccount] = useState<PickOption | null>(null);
  const [accQ, setAccQ] = useState("");
  const [accOpts, setAccOpts] = useState<PickOption[]>([]);
  const [accOpen, setAccOpen] = useState(false);
  const accTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 新規
  const [newCompany, setNewCompany] = useState("");

  // 担当者
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");

  // アポ・獲得情報
  const [owner, setOwner] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("");
  const [product, setProduct] = useState("");
  const [source, setSource] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");   // 流入詳細(テキスト値)
  const [detailFree, setDetailFree] = useState(false);    // 「その他(直接入力)」中か
  const [memo, setMemo] = useState("");
  const [acquiredBy, setAcquiredBy] = useState(currentUserId);
  const [acquiredOn, setAcquiredOn] = useState(todayStr());

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ opportunityId: string; accountName: string } | null>(null);

  useEffect(() => {
    if (!leadOpen) return;
    if (leadTimer.current) clearTimeout(leadTimer.current);
    leadTimer.current = setTimeout(async () => setLeadOpts(await searchApptLeadsAction(leadQ)), 200);
    return () => { if (leadTimer.current) clearTimeout(leadTimer.current); };
  }, [leadQ, leadOpen]);

  useEffect(() => {
    if (!accOpen) return;
    if (accTimer.current) clearTimeout(accTimer.current);
    accTimer.current = setTimeout(async () => setAccOpts(await searchAccountsAction(accQ)), 200);
    return () => { if (accTimer.current) clearTimeout(accTimer.current); };
  }, [accQ, accOpen]);

  /** 流入経路＋詳細をプレフィル。詳細がマスタに無ければ「直接入力」欄に載せる。 */
  function applySource(srcId: string | null, detailText: string | null) {
    const sid = srcId ?? "";
    setSource(sid);
    const dt = detailText ?? "";
    setSourceDetail(dt);
    const inMaster = !!dt && details.some((d) => d.lead_source_id === sid && d.name === dt);
    setDetailFree(!!dt && !inMaster);
  }

  async function pickLead(hit: ApptLeadHit) {
    setLeadOpen(false);
    setLeadQ("");
    const d = await getApptLeadDetailAction(hit.id);
    if (!d) return;
    setLead(d);
    // リード情報を担当者欄にプレフィル(編集可)
    setCName(d.contact_name ?? "");
    setCTitle(d.job_title ?? "");
    setCPhone(d.phone ?? "");
    setCEmail(d.email ?? "");
    // 流入経路・詳細もDBの保持情報から引き出す(raw_event=展示会名等)
    applySource(d.lead_source_id, d.raw_event);
  }

  async function pickAccount(o: PickOption) {
    setAccount(o); setAccOpen(false); setAccQ("");
    // 既存顧客は直近案件の流入経路/詳細をDBから引き出してプレフィル
    const s = await getAccountSourceAction(o.id);
    applySource(s.lead_source_id, s.source_detail);
  }

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
      leadId: mode === "lead" ? (lead?.id ?? null) : null,
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
      sourceDetail: sourceDetail.trim() || null,
      memo: memo || null,
      acquiredById: acquiredBy || null,
      acquiredOn: acquiredOn || null,
    });
    setSaving(false);
    if (res.ok) setDone({ opportunityId: res.opportunityId, accountName: res.accountName });
    else setError(res.error);
  }

  function resetForNext() {
    setDone(null); setLead(null); setAccount(null); setNewCompany(""); setLeadQ(""); setAccQ("");
    setCName(""); setCTitle(""); setCPhone(""); setCEmail("");
    setDate(todayStr()); setTime(""); setMemo("");
    setSourceDetail(""); setDetailFree(false); // 流入詳細は相手先ごとに異なるためクリア
    // 営業担当・商材・流入経路・獲得担当者・獲得日は連続登録のため維持
  }

  if (done) {
    return (
      <div className="card card-pad max-w-xl text-center space-y-4">
        <CheckCircle2 size={40} className="mx-auto text-teal-primary" />
        <div>
          <div className="text-lg font-bold text-ink">アポを登録しました</div>
          <div className="text-sm text-ink/60 mt-1">{done.accountName} ／ {date}{time ? ` ${time}` : ""}（担当: {ownerName}）</div>
          <div className="text-xs text-ink/45 mt-1">案件（ヨミ: 4.アポ）としてカレンダー・案件一覧に反映。リード起点の場合はリードもアポ決着に更新されました。</div>
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
        {/* 1. 相手先 */}
        <div className="card card-pad space-y-3">
          <div className="text-sm font-semibold text-ink">1. 相手先</div>
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
            <TabBtn active={mode === "lead"} onClick={() => setMode("lead")} label="リードから検索" />
            <TabBtn active={mode === "existing"} onClick={() => setMode("existing")} label="既存顧客から検索" />
            <TabBtn active={mode === "new"} onClick={() => setMode("new")} label="新規登録" />
          </div>

          {mode === "lead" && (
            lead ? (
              <div className="rounded-xl border border-teal-primary/40 bg-teal-light/20 p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-teal-deep" />
                  <span className="font-semibold text-ink">{lead.company_name}</span>
                  {lead.rank && <span className="pill bg-mist-soft text-ink/60 text-[10px]">ランク {lead.rank}</span>}
                  <button type="button" onClick={() => { setLead(null); setCName(""); setCTitle(""); setCPhone(""); setCEmail(""); }} className="ml-auto text-xs text-ink/40 hover:text-rose-500">変更</button>
                </div>
                <div className="text-xs text-ink/60">
                  {[lead.contact_name, lead.department, lead.job_title].filter(Boolean).join(" / ") || "担当者情報なし"}
                </div>
                <div className="text-[11px] text-ink/50">
                  {[lead.raw_event && `獲得: ${lead.raw_event}`, lead.industry, lead.employee_size].filter(Boolean).join(" ・ ")}
                </div>
                {lead.notes && <div className="text-[11px] text-ink/50 line-clamp-2">メモ: {lead.notes}</div>}
                <p className="text-[10px] text-teal-deep">↑ この詳細情報は案件の「事前リサーチ」に自動コピーされます</p>
              </div>
            ) : (
              <div className="relative">
                <input value={leadQ} onFocus={() => setLeadOpen(true)} onChange={(e) => { setLeadQ(e.target.value); setLeadOpen(true); }} placeholder="会社名・担当者名でリードを検索（展示会リスト等）" className="input" />
                {leadOpen && leadOpts.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
                    {leadOpts.map((h) => (
                      <button key={h.id} type="button" onClick={() => pickLead(h)} className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft">
                        <span className="font-medium">{h.company}</span>
                        <span className="text-xs text-ink/45 ml-2">{[h.contact, h.event].filter(Boolean).join(" ・ ")}</span>
                        {h.rank && <span className="pill bg-mist-soft text-ink/55 text-[10px] ml-2">{h.rank}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {mode === "existing" && (
            account ? (
              <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-mist-soft/40 px-3 py-2 text-sm">
                <span className="flex-1">{account.label}</span>
                <button type="button" onClick={() => setAccount(null)} className="text-xs text-ink/40 hover:text-rose-500">変更</button>
              </div>
            ) : (
              <div className="relative">
                <input value={accQ} onFocus={() => setAccOpen(true)} onChange={(e) => { setAccQ(e.target.value); setAccOpen(true); }} placeholder="会社名で既存顧客を検索" className="input" />
                {accOpen && accOpts.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
                    {accOpts.map((o) => (
                      <button key={o.id} type="button" onClick={() => pickAccount(o)} className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft">
                        {o.label}{o.sub && <span className="text-ink/40 ml-1 text-xs">{o.sub}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {mode === "new" && (
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
              <label className="label">流入経路（任意・リード/既存顧客は自動）</label>
              <select
                value={source}
                onChange={(e) => { setSource(e.target.value); setSourceDetail(""); setDetailFree(false); }}
                className="input"
              >
                <option value="">—</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          {source && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">流入詳細（どの展示会・どのパートナー等）</label>
                <select
                  value={detailFree ? DETAIL_FREE : sourceDetail}
                  onChange={(e) => {
                    if (e.target.value === DETAIL_FREE) { setDetailFree(true); setSourceDetail(""); }
                    else { setDetailFree(false); setSourceDetail(e.target.value); }
                  }}
                  className="input"
                >
                  <option value="">—</option>
                  {details.filter((d) => d.lead_source_id === source).map((d) => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                  <option value={DETAIL_FREE}>その他（直接入力）</option>
                </select>
              </div>
              {detailFree && (
                <div>
                  <label className="label">詳細を入力</label>
                  <input
                    value={sourceDetail}
                    onChange={(e) => setSourceDetail(e.target.value)}
                    placeholder="例：〇〇展示会 / △△パートナー"
                    className="input"
                  />
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label">アポ獲得メモ（話した内容）</label>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} placeholder="架電で話した内容・課題・温度感・注意点。リード詳細と一緒に案件の「事前リサーチ」へ保存され、営業担当が商談前に確認できます" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">アポ獲得担当者</label>
              <select value={acquiredBy} onChange={(e) => setAcquiredBy(e.target.value)} className="input">
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">獲得日</label>
              <input type="date" value={acquiredOn} onChange={(e) => setAcquiredOn(e.target.value)} className="input" />
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{error}</div>}
        <button type="button" onClick={submit} disabled={saving} className={cn("btn-accent", saving && "opacity-50")}>
          {saving ? "登録中…" : "アポを登録（案件を作成）"}
        </button>
      </div>

      {/* 予約URL */}
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

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-lg px-3 py-1.5 font-medium", active ? "bg-teal-primary text-white" : "text-ink/55")}>
      {label}
    </button>
  );
}
