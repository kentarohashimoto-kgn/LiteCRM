"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Phone, Mail, ExternalLink, Loader2, Gauge, Flame } from "lucide-react";
import { getLeadPanelAction, type LeadPanelData } from "@/server/actions/lead-panel";
import { setLeadDispositionAction, setLeadHearingAction } from "@/server/actions";
import { setLeadHandlerAction } from "@/server/actions/lead-handlers";
import { LEAD_DISPOSITIONS } from "@/lib/constants";
import { GRADE_DEFS, type PriorityGrade } from "@/lib/engagement";
import { cn, formatAcquiredAt, formatDateFull, formatDateTimeJst } from "@/lib/utils";

/**
 * リード詳細サイドパネル。一覧から画面遷移せずに内容確認・その場でヒアリング/決着を更新できる。
 * ESCまたは背景クリックで閉じる。深掘りが要る時だけ「詳細ページ」へ遷移する。
 */

const AXIS_LABEL: Record<string, string> = {
  size: "規模", role: "役職", needs: "課題", timing: "時期", budget: "予算", industry_fit: "業界相性",
  issue: "課題", fit: "予算",  // 旧キー(0050以前のデータ)との互換
};

const ENG_COLOR: Record<string, string> = {
  S: "bg-rose-100 text-rose-600", A: "bg-amber-100 text-amber-700", B: "bg-teal-light text-teal-deep",
  C: "bg-mist-soft text-ink/60", D: "bg-mist-soft text-ink/35",
};

function HearingSel({ id, field, value, opts, ph, onSaved }: {
  id: string; field: string; value: string; opts: { key: string; label: string }[]; ph: string; onSaved: () => void;
}) {
  return (
    <form action={async (fd) => { await setLeadHearingAction(fd); onSaved(); }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value={field} />
      <select
        name="value"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={cn("w-full rounded-lg border px-2 py-1 text-xs outline-none focus:border-teal-primary", value ? "border-teal-primary/40 bg-teal-light/20 text-teal-deep" : "border-black/10 bg-white text-ink/50")}
      >
        <option value="">{ph}</option>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </form>
  );
}

const HANDLER_SRC_LABEL: Record<string, string> = {
  memo: "メモから判定", card: "名刺から判定", both: "メモ+名刺", manual: "手動設定",
};

export function LeadSidePanel({ leadId, onClose, handlers = [] }: { leadId: string | null; onClose: () => void; handlers?: string[] }) {
  const [data, setData] = useState<LeadPanelData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    try { setData(await getLeadPanelAction(id)); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!leadId) { setData(null); return; }
    void load(leadId);
  }, [leadId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (leadId) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leadId, onClose]);

  if (!leadId) return null;
  const l = data?.lead;
  const eng = data?.engagement;
  const grade = (l?.priorityGrade as PriorityGrade | null) ?? null;
  const tel = (l?.phone || l?.mobilePhone || "").replace(/[^0-9+]/g, "");
  const detail = l?.scoreDetail ?? {};

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl border-l border-black/10">
        {loading && !l && (
          <div className="flex h-full items-center justify-center text-ink/40"><Loader2 size={20} className="animate-spin" /></div>
        )}
        {data && !data.ok && (
          <div className="p-5 text-sm text-rose-600">{data.error}</div>
        )}
        {l && (
          <div className="p-5 space-y-4">
            {/* ヘッダー */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {l.rank && <span className={cn("pill text-[10px] font-bold", ENG_COLOR[l.rank] ?? ENG_COLOR.D)}>{l.rank}</span>}
                  {grade && (
                    <span className="pill text-[10px] font-bold bg-rose-100 text-rose-700" title={GRADE_DEFS[grade].action}>
                      <Flame size={9} className="inline -mt-0.5 mr-0.5" />{GRADE_DEFS[grade].label}
                    </span>
                  )}
                  {l.converted && <span className="pill bg-teal-light text-teal-deep text-[10px]">案件化済</span>}
                </div>
                <h2 className="font-semibold text-ink mt-1 leading-snug">{l.company || "(会社名なし)"}</h2>
                <p className="text-sm text-ink/55">{l.contact}{l.jobTitle && ` ／ ${l.jobTitle}`}</p>
              </div>
              <button onClick={onClose} className="text-ink/40 hover:text-ink shrink-0"><X size={18} /></button>
            </div>

            {/* クイックアクション */}
            <div className="flex flex-wrap gap-2">
              {tel && <a href={`tel:${tel}`} className="btn-accent inline-flex items-center gap-1 text-xs"><Phone size={13} /> 発信</a>}
              {l.email && <a href={`mailto:${l.email}`} className="btn-ghost inline-flex items-center gap-1 text-xs"><Mail size={13} /> メール</a>}
              <Link href={`/app/leads/${l.id}`} className="btn-ghost inline-flex items-center gap-1 text-xs"><ExternalLink size={13} /> 詳細ページ</Link>
              {l.opportunityId && (
                <Link href={`/app/opportunities/${l.opportunityId}`} className="btn-ghost inline-flex items-center gap-1 text-xs">案件を開く</Link>
              )}
            </div>

            {/* スコア内訳 */}
            <div className="rounded-xl border border-black/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink/70 inline-flex items-center gap-1"><Gauge size={13} /> スコア</span>
                <span className="text-sm tabular-nums font-bold text-teal-deep">{l.leadScore ?? 0} / 100</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(detail)
                  .filter(([k, v]) => k in AXIS_LABEL && typeof v === "number" && (v as number) > 0)
                  .map(([k, v]) => (
                    <span key={k} className="pill bg-mist-soft text-ink/60 text-[10px] tabular-nums">{AXIS_LABEL[k]} +{v}</span>
                  ))}
                {Object.keys(detail).length === 0 && <span className="text-xs text-ink/40">未スコア</span>}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-black/[0.06]">
                <span className="text-xs text-ink/50">反応</span>
                <span className={cn("pill text-[10px] font-bold", ENG_COLOR[eng?.rank ?? "D"])}>{eng?.rank ?? "D"}</span>
                <span className="text-xs text-ink/45 tabular-nums">{eng?.score ?? 0}pt・接点{eng?.touchCount ?? 0}件</span>
              </div>
            </div>

            {/* ヒアリング(その場で更新→即再スコア) */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-ink/70">ヒアリング（選ぶと即スコアに反映）</p>
              <div className="grid grid-cols-3 gap-1.5">
                <HearingSel id={l.id} field="needs" value={l.needs ?? ""} ph="課題" onSaved={() => load(l.id)}
                  opts={[{ key: "high", label: "具体的に興味" }, { key: "mid", label: "関心あり" }, { key: "low", label: "低い/不明" }]} />
                <HearingSel id={l.id} field="timing" value={l.timing ?? ""} ph="時期" onSaved={() => load(l.id)}
                  opts={[{ key: "now", label: "すぐ導入" }, { key: "soon", label: "数ヶ月内" }, { key: "unknown", label: "未定" }]} />
                <HearingSel id={l.id} field="budget_band" value={l.budgetBand ?? ""} ph="予算" onSaved={() => load(l.id)}
                  opts={[{ key: "yes", label: "予算あり" }, { key: "considering", label: "検討中" }, { key: "no", label: "なし/不明" }]} />
              </div>
            </div>

            {/* 決着 */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-ink/70">決着</p>
              <form action={async (fd) => { await setLeadDispositionAction(fd); void load(l.id); }}>
                <input type="hidden" name="id" value={l.id} />
                <select name="disposition" defaultValue={l.disposition} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="input text-sm">
                  {LEAD_DISPOSITIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </form>
            </div>

            {/* 対応者(FS接客者) */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-ink/70">
                対応者（接客）
                {l.handledBySource && (
                  <span className="ml-1.5 pill bg-mist-soft text-ink/50 text-[9px] font-normal">{HANDLER_SRC_LABEL[l.handledBySource] ?? l.handledBySource}</span>
                )}
              </p>
              <select
                defaultValue={l.handledBy ?? ""}
                onChange={async (e) => { await setLeadHandlerAction({ leadId: l.id, handlerName: e.target.value || null }); void load(l.id); }}
                className={cn("input text-sm", l.handledBy ? "border-rose-300 bg-rose-50/40 text-rose-700" : "")}
              >
                <option value="">（なし）</option>
                {[...new Set([...(handlers ?? []), ...(l.handledBy ? [l.handledBy] : [])])].map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <p className="text-[11px] text-ink/40">社長・責任者が接客したリードはスコアで優遇されます。手で変更すると以後の自動判定では上書きされません。</p>
            </div>

            {/* 基本情報 */}
            <div className="rounded-xl border border-black/10 divide-y divide-black/[0.05] text-xs">
              {[
                ["メール", l.email],
                ["電話", [l.phone, l.mobilePhone].filter(Boolean).join(" / ")],
                ["部署", l.department],
                ["業界", l.industry],
                ["従業員数", l.employeeSize],
                ["流入", l.event],
                ["獲得担当", l.acquirer],
                ["獲得日時", formatAcquiredAt(l.scannedAt, l.acquiredAt)],
                ["取込日時", l.createdAt ? formatDateTimeJst(l.createdAt) : null],
              ].map(([label, value]) => (
                <div key={label as string} className="flex gap-2 px-3 py-1.5">
                  <span className="w-20 shrink-0 text-ink/40">{label}</span>
                  <span className="text-ink/75 break-all">{(value as string) || "—"}</span>
                </div>
              ))}
            </div>

            {/* メモ */}
            {l.notes && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-ink/70">メモ（ヒアリング内容）</p>
                <p className="rounded-xl bg-mist-soft/50 p-3 text-xs text-ink/70 whitespace-pre-wrap leading-relaxed">{l.notes}</p>
              </div>
            )}

            {/* 接点履歴 */}
            {(data?.touchpoints?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-ink/70">接点・反応履歴</p>
                <ul className="flex flex-wrap gap-1.5">
                  {data!.touchpoints!.map((t, i) => (
                    <li key={i} className="inline-flex items-center gap-1 rounded-lg bg-mist-soft/70 px-2 py-1 text-[11px]">
                      <span className="text-ink/75">{t.label}</span>
                      <span className="text-ink/40">+{t.weight}</span>
                      {t.occurredAt && <span className="text-ink/35">{formatDateFull(t.occurredAt)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
