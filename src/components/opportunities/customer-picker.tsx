"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Sparkles, Building2, UserPlus } from "lucide-react";
import {
  searchApptLeadsAction,
  getApptLeadDetailAction,
  type ApptLeadHit,
  type ApptLeadDetail,
} from "@/server/actions/appointments";
import { searchAccountsAction, type PickOption } from "@/server/actions/activities";
import { cn } from "@/lib/utils";

type Mode = "existing" | "lead" | "new";

/**
 * 案件・商談登録時の「顧客」選択＋新規登録をシームレスに行うピッカー。
 * 顧客(account) > リード(顧客＋担当者個人) > 案件/商談 の階層に沿って、
 * 既存顧客の検索・過去リードからの起票・新規顧客の即時登録を1か所で行う。
 *
 * 親フォーム(server action)へは hidden input で以下を送出:
 *   account_id / lead_id / new_company_name / contact_name / contact_title /
 *   contact_phone / contact_email
 * 顧客の解決(既存紐付け/リード起点/新規作成)と担当者作成はサーバ側で行う。
 */
export function CustomerPicker({ onCompanyResolved, onSourceResolved }: {
  onCompanyResolved?: (name: string) => void;
  onSourceResolved?: (leadSourceId: string | null, detail: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("existing");

  // 既存顧客
  const [account, setAccount] = useState<PickOption | null>(null);
  const [accQ, setAccQ] = useState("");
  const [accOpts, setAccOpts] = useState<PickOption[]>([]);
  const [accOpen, setAccOpen] = useState(false);
  const accTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // リード
  const [lead, setLead] = useState<ApptLeadDetail | null>(null);
  const [leadQ, setLeadQ] = useState("");
  const [leadOpts, setLeadOpts] = useState<ApptLeadHit[]>([]);
  const [leadOpen, setLeadOpen] = useState(false);
  const leadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 新規顧客
  const [newCompany, setNewCompany] = useState("");

  // 担当者(リード起点/新規で使用・編集可)
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");

  useEffect(() => {
    if (!accOpen) return;
    if (accTimer.current) clearTimeout(accTimer.current);
    accTimer.current = setTimeout(async () => setAccOpts(await searchAccountsAction(accQ)), 200);
    return () => { if (accTimer.current) clearTimeout(accTimer.current); };
  }, [accQ, accOpen]);

  useEffect(() => {
    if (!leadOpen) return;
    if (leadTimer.current) clearTimeout(leadTimer.current);
    leadTimer.current = setTimeout(async () => setLeadOpts(await searchApptLeadsAction(leadQ)), 200);
    return () => { if (leadTimer.current) clearTimeout(leadTimer.current); };
  }, [leadQ, leadOpen]);

  function pickAccount(o: PickOption) {
    setAccount(o); setAccOpen(false); setAccQ("");
    onCompanyResolved?.(o.label);
  }

  async function pickLead(hit: ApptLeadHit) {
    setLeadOpen(false); setLeadQ("");
    const d = await getApptLeadDetailAction(hit.id);
    if (!d) return;
    setLead(d);
    setCName(d.contact_name ?? "");
    setCTitle(d.job_title ?? "");
    setCPhone(d.phone ?? "");
    setCEmail(d.email ?? "");
    if (d.company_name) onCompanyResolved?.(d.company_name);
    // リードの流入経路・詳細(展示会名等)をフォームの流入経路欄へ反映
    onSourceResolved?.(d.lead_source_id, d.raw_event);
  }

  function switchMode(m: Mode) {
    setMode(m);
    // モード切替で他モードの選択はクリア(hidden inputの重複送出を防ぐ)
    if (m !== "existing") setAccount(null);
    if (m !== "lead") setLead(null);
    if (m !== "new") setNewCompany("");
  }

  return (
    <div className="rounded-xl border border-black/10 bg-mist-soft/30 p-3 space-y-3">
      <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
        <Tab active={mode === "existing"} onClick={() => switchMode("existing")} icon={Building2} label="既存顧客から" />
        <Tab active={mode === "lead"} onClick={() => switchMode("lead")} icon={Sparkles} label="リードから" />
        <Tab active={mode === "new"} onClick={() => switchMode("new")} icon={UserPlus} label="新規顧客" />
      </div>

      {/* 既存顧客 */}
      {mode === "existing" && (
        account ? (
          <div className="flex items-center gap-2 rounded-lg border border-teal-primary/40 bg-teal-light/20 px-3 py-2 text-sm">
            <Building2 size={14} className="text-teal-deep" />
            <span className="flex-1 font-medium">{account.label}</span>
            <input type="hidden" name="account_id" value={account.id} />
            <button type="button" onClick={() => setAccount(null)} className="text-xs text-ink/40 hover:text-rose-500">変更</button>
          </div>
        ) : (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input value={accQ} onFocus={() => setAccOpen(true)} onChange={(e) => { setAccQ(e.target.value); setAccOpen(true); }} placeholder="会社名で既存顧客を検索" className="input pl-8" />
            {accOpen && accOpts.length > 0 && (
              <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
                {accOpts.map((o) => (
                  <button key={o.id} type="button" onClick={() => pickAccount(o)} className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft">
                    {o.label}{o.sub && <span className="text-ink/40 ml-1 text-xs">{o.sub}</span>}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-ink/45 mt-1">見つからない場合は「新規顧客」タブでその場で登録できます。</p>
          </div>
        )
      )}

      {/* リードから */}
      {mode === "lead" && (
        lead ? (
          <div className="rounded-xl border border-teal-primary/40 bg-teal-light/20 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-teal-deep" />
              <span className="font-semibold text-ink">{lead.company_name}</span>
              {lead.rank && <span className="pill bg-mist-soft text-ink/60 text-[10px]">ランク {lead.rank}</span>}
              <button type="button" onClick={() => { setLead(null); setCName(""); setCTitle(""); setCPhone(""); setCEmail(""); }} className="ml-auto text-xs text-ink/40 hover:text-rose-500">変更</button>
            </div>
            <div className="text-[11px] text-ink/55">{[lead.raw_event && `獲得: ${lead.raw_event}`, lead.industry, lead.prefecture].filter(Boolean).join(" ・ ")}</div>
            <input type="hidden" name="lead_id" value={lead.id} />
            <p className="text-[10px] text-teal-deep">↑ リードの顧客・担当者・流入情報が案件に引き継がれます（顧客が無ければ自動作成）。</p>
          </div>
        ) : (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input value={leadQ} onFocus={() => setLeadOpen(true)} onChange={(e) => { setLeadQ(e.target.value); setLeadOpen(true); }} placeholder="会社名・担当者名でリードを検索（展示会リスト等）" className="input pl-8" />
            {leadOpen && leadOpts.length > 0 && (
              <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
                {leadOpts.map((h) => (
                  <button key={h.id} type="button" onClick={() => pickLead(h)} className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft">
                    <span className="font-medium">{h.company}</span>
                    <span className="text-xs text-ink/45 ml-2">{[h.contact, h.event].filter(Boolean).join(" ・ ")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* 新規顧客 */}
      {mode === "new" && (
        <input name="new_company_name" value={newCompany}
          onChange={(e) => { setNewCompany(e.target.value); onCompanyResolved?.(e.target.value); }}
          placeholder="会社名（同名の既存顧客があれば自動で紐づけます）" className="input" />
      )}

      {/* 担当者(顧客の下＝個人情報)。リード起点/新規で入力・編集可 */}
      {mode !== "existing" && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-ink/50">顧客担当者（任意）</div>
          <div className="grid grid-cols-2 gap-2">
            <input name="contact_name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="担当者名" className="input" />
            <input name="contact_title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="役職" className="input" />
            <input name="contact_phone" value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder="電話" className="input" />
            <input name="contact_email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="メール" className="input" />
          </div>
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium", active ? "bg-teal-primary text-white" : "text-ink/55")}>
      <Icon size={13} /> {label}
    </button>
  );
}
