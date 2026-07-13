"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, ChevronLeft, ChevronRight, ExternalLink, Save, Loader2, CheckCircle2 } from "lucide-react";
import { YOMI_OPTIONS } from "@/lib/constants";
import { formatYen, formatDate, cn } from "@/lib/utils";
import { getRepOppDetailAction, saveRepOppFieldsAction } from "@/server/actions/rep-report";
import type { RepOppDetail } from "@/lib/data/rep-report";

const ROLE_LABEL: Record<string, string> = { decision_maker: "意思決定者", influencer: "影響者", user: "利用者", referrer: "紹介者" };
const REASON_YOMI: Record<string, string> = {
  "0.受注": "受注の要因(勝因)を一言…",
  "6.定期追い": "定期追いに切り替える要因を一言…",
  "7.オチ": "オチた要因を一言…",
};

type Editable = { yomi: string; repCloseMonth: string; repAmountForecast: string; repMeetingsLeft: string; statusNote: string; yomiReason: string };

/**
 * 週報の案件レビュー用サイドパネル(案A)。
 * 案件名クリックで開き、事前リサーチ・営業戦略・直近活動/商談・担当者を確認しつつ
 * ヨミ等をその場で更新。「← 前 / 次 →」で一覧の並び順どおり連続レビュー。
 * 保存はリダイレクトせず、背後の週報一覧を router.refresh() で更新する。
 */
export function RepOppDrawer({
  oppId,
  index,
  total,
  onClose,
  onNav,
}: {
  oppId: string | null;
  index: number; // 一覧内の位置(0-based)
  total: number;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<RepOppDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<Editable | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setSavedTick(false);
    try {
      const d = await getRepOppDetailAction(id);
      setDetail(d);
      if (d) {
        setEdit({
          yomi: d.yomi ?? "",
          repCloseMonth: d.repCloseMonth ?? "",
          repAmountForecast: d.repAmountForecast != null ? String(d.repAmountForecast) : "",
          repMeetingsLeft: d.repMeetingsLeft != null ? String(d.repMeetingsLeft) : "",
          statusNote: d.statusNote ?? "",
          yomiReason: "",
        });
      }
    } catch {
      setError("案件情報の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (oppId) load(oppId);
    else { setDetail(null); setEdit(null); }
  }, [oppId, load]);

  // Escで閉じる
  useEffect(() => {
    if (!oppId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oppId, onClose]);

  if (!oppId) return null;

  const yomiChanged = !!edit && edit.yomi !== (detail?.yomi ?? "");
  const reasonPh = yomiChanged ? REASON_YOMI[edit!.yomi] : undefined;

  const save = async (thenNav?: 1) => {
    if (!edit || !detail) return;
    setSaving(true);
    setError(null);
    const res = await saveRepOppFieldsAction({
      oppId: detail.id,
      yomi: edit.yomi || null,
      repCloseMonth: edit.repCloseMonth || null,
      repAmountForecast: edit.repAmountForecast ? Number(edit.repAmountForecast.replace(/[^\d]/g, "")) : null,
      repMeetingsLeft: edit.repMeetingsLeft ? Number(edit.repMeetingsLeft) : null,
      statusNote: edit.statusNote || null,
      yomiReason: edit.yomiReason || null,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error || "保存に失敗しました。"); return; }
    router.refresh(); // 背後の週報一覧を更新(パネルは開いたまま)
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1400);
    if (thenNav && index < total - 1) onNav(1);
  };

  const set = (patch: Partial<Editable>) => setEdit((e) => (e ? { ...e, ...patch } : e));

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-white shadow-2xl flex flex-col animate-[slideIn_.18s_ease-out]">
        <style>{`@keyframes slideIn{from{transform:translateX(24px);opacity:.4}to{transform:translateX(0);opacity:1}}`}</style>

        {/* ヘッダ */}
        <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-3">
          <span className="text-xs text-ink/40 tabular-nums">{index + 1} / {total}</span>
          <div className="flex items-center gap-1 ml-1">
            <button onClick={() => onNav(-1)} disabled={index <= 0} className="btn-ghost p-1 disabled:opacity-30" title="前の案件" aria-label="前の案件"><ChevronLeft size={16} /></button>
            <button onClick={() => onNav(1)} disabled={index >= total - 1} className="btn-ghost p-1 disabled:opacity-30" title="次の案件" aria-label="次の案件"><ChevronRight size={16} /></button>
          </div>
          <div className="ml-2 min-w-0 flex-1">
            <div className="truncate font-semibold text-ink">{detail?.name ?? "…"}</div>
            <div className="truncate text-xs text-ink/50">{detail?.accountName ?? ""}{detail?.ownerName ? ` ・ 担当:${detail.ownerName}` : ""}</div>
          </div>
          {detail && (
            <Link href={`/app/opportunities/${detail.id}`} className="btn-ghost p-1 text-ink/50" title="案件詳細を別ページで開く" target="_blank"><ExternalLink size={15} /></Link>
          )}
          <button onClick={onClose} className="btn-ghost p-1" title="閉じる(Esc)" aria-label="閉じる"><X size={17} /></button>
        </div>

        {/* 本体 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading && <div className="flex items-center gap-2 text-sm text-ink/50 py-8 justify-center"><Loader2 size={16} className="animate-spin" /> 読み込み中…</div>}
          {!loading && !detail && <p className="text-sm text-ink/50 py-8 text-center">案件が見つかりませんでした。</p>}

          {!loading && detail && edit && (
            <>
              {/* 更新パネル(先頭・常時見える) */}
              <div className="rounded-xl border border-teal-primary/20 bg-teal-light/25 p-3 space-y-2.5">
                <div className="text-xs font-bold text-teal-deep">この案件を更新</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="text-xs text-ink/60">ヨミ
                    <select value={edit.yomi} onChange={(e) => set({ yomi: e.target.value })} className="input text-sm mt-0.5 w-full">
                      <option value="">—</option>
                      {YOMI_OPTIONS.map((y) => <option key={y.key} value={y.key}>{y.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-ink/60">成約月(読み)
                    <input type="month" value={edit.repCloseMonth} onChange={(e) => set({ repCloseMonth: e.target.value })} className="input text-sm mt-0.5 w-full" />
                  </label>
                  <label className="text-xs text-ink/60">売上見込(読み)
                    <input inputMode="numeric" value={edit.repAmountForecast} onChange={(e) => set({ repAmountForecast: e.target.value })} placeholder="円" className="input text-sm mt-0.5 w-full text-right" />
                  </label>
                  <label className="text-xs text-ink/60">残商談(回)
                    <input inputMode="numeric" value={edit.repMeetingsLeft} onChange={(e) => set({ repMeetingsLeft: e.target.value })} placeholder="回" className="input text-sm mt-0.5 w-full text-right" />
                  </label>
                </div>
                {reasonPh && (
                  <input value={edit.yomiReason} onChange={(e) => set({ yomiReason: e.target.value })} placeholder={reasonPh} maxLength={200}
                    className="input text-sm w-full border-accent-orange/50 bg-amber-50/50" />
                )}
                <label className="text-xs text-ink/60 block">メモ(状況)
                  <input value={edit.statusNote} onChange={(e) => set({ statusNote: e.target.value })} placeholder="状況を一言…" maxLength={120} className="input text-sm mt-0.5 w-full" />
                </label>
                <div className="flex items-center gap-2 pt-0.5">
                  <button onClick={() => save()} disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存
                  </button>
                  {index < total - 1 && (
                    <button onClick={() => save(1)} disabled={saving} className="btn-accent text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                      保存して次へ <ChevronRight size={14} />
                    </button>
                  )}
                  {savedTick && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={14} /> 保存しました</span>}
                  {error && <span className="text-xs text-rose-600">{error}</span>}
                </div>
              </div>

              {/* 現況サマリー */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-mist-soft/40 py-2"><div className="text-[10px] text-ink/45">金額</div><div className="text-sm font-semibold tabular-nums">{formatYen(detail.amount)}</div></div>
                <div className="rounded-lg bg-mist-soft/40 py-2"><div className="text-[10px] text-ink/45">次回AC</div><div className="text-sm font-semibold">{detail.nextActionDate ? formatDate(detail.nextActionDate) : <span className="text-rose-500">未設定</span>}</div></div>
                <div className="rounded-lg bg-mist-soft/40 py-2"><div className="text-[10px] text-ink/45">成約予定</div><div className="text-sm font-semibold">{detail.expectedCloseDate ? formatDate(detail.expectedCloseDate) : "—"}</div></div>
              </div>
              {detail.nextActionText && <p className="text-xs text-ink/60">次アクション: {detail.nextActionText}</p>}

              {/* 担当者 */}
              {detail.contacts.length > 0 && (
                <Sec title="担当者">
                  <ul className="space-y-1.5">
                    {detail.contacts.map((c) => (
                      <li key={c.id} className="text-sm">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {c.isAccounter && <span className="pill bg-teal-primary text-white text-[10px] font-bold">アカウンター</span>}
                          <span className="font-medium">{c.name}</span>
                          {c.decisionRole && ROLE_LABEL[c.decisionRole] && <span className="pill bg-black/[0.05] text-ink/55 text-[10px]">{ROLE_LABEL[c.decisionRole]}</span>}
                        </span>
                        <span className="block text-xs text-ink/55">{[c.department, c.title].filter(Boolean).join("・") || "部署・役職 未登録"}</span>
                      </li>
                    ))}
                  </ul>
                </Sec>
              )}

              {/* 事前リサーチ / 営業戦略 */}
              {detail.preResearch && <Sec title="事前リサーチ"><p className="text-xs text-ink/75 whitespace-pre-wrap max-h-52 overflow-y-auto">{detail.preResearch}</p></Sec>}
              {detail.salesStrategy && <Sec title="営業戦略"><p className="text-xs text-ink/75 whitespace-pre-wrap max-h-40 overflow-y-auto">{detail.salesStrategy}</p></Sec>}
              {detail.notes && <Sec title="メモ"><p className="text-xs text-ink/75 whitespace-pre-wrap">{detail.notes}</p></Sec>}

              {/* 直近の商談 */}
              {detail.meetings.length > 0 && (
                <Sec title={`直近の商談（${detail.meetings.length}）`}>
                  <ul className="space-y-2">
                    {detail.meetings.map((mt) => (
                      <li key={mt.id} className="rounded-lg border border-black/[0.05] p-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-ink/80">{mt.title || "商談"}</span>
                          <span className="text-ink/45 tabular-nums">{mt.date ? formatDate(mt.date) : ""}</span>
                        </div>
                        {(mt.aiSummary || mt.minutes) && (
                          <p className="mt-1 text-[11px] text-ink/60 whitespace-pre-wrap max-h-32 overflow-y-auto">{(mt.aiSummary || mt.minutes || "").slice(0, 600)}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </Sec>
              )}

              {/* 直近の活動 */}
              {detail.activities.length > 0 && (
                <Sec title={`直近の活動（${detail.activities.length}）`}>
                  <ul className="space-y-1.5">
                    {detail.activities.map((a) => (
                      <li key={a.id} className="text-xs">
                        <span className="text-ink/45 tabular-nums mr-1.5">{a.at ? formatDate(a.at) : ""}</span>
                        <span className="text-ink/80">{a.title || a.type || "活動"}</span>
                        {a.body && <span className="block text-ink/55 line-clamp-2">{a.body}</span>}
                      </li>
                    ))}
                  </ul>
                </Sec>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-ink/45 mb-1">{title}</div>
      {children}
    </div>
  );
}
