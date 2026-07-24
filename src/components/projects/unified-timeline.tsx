"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, TriangleAlert, Users, TrendingUp, X, CalendarRange } from "lucide-react";
import { saveDeliveryForecastAction, deleteDeliveryForecastAction } from "@/server/actions/forecasts";
import type { ForecastAlerts, ForecastRow } from "@/lib/data/forecasts";

/** 確定(原価管理対象)案件の行データ。page.tsx から渡す。 */
export interface ConfirmedRow {
  opportunityId: string;
  accountName: string;
  oppName: string;
  priority: "high" | "middle" | "low";
  startMonth: string | null; // YYYY-MM
  endMonth: string | null;
  isActive: boolean;
  isFuture: boolean;
  isPast: boolean;
  revenue: number;
  grossRate: number;
  monthly: { month: string; revenue: number }[];
}

export interface LinkOption { id: string; label: string }

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const yenShort = (n: number): string => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};
const ymLabel = (m: string) => Number(m.split("-")[1]) + "月";
const ymFull = (m: string) => { const [y, mo] = m.split("-"); return `${y}/${Number(mo)}`; };

function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const idx = y * 12 + (mo - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a, guard = 0;
  while (guard++ < 40) { out.push(cur); if (cur === b) break; cur = addMonths(cur, 1); }
  return out;
}

const PRIO = { high: { label: "高", cls: "bg-rose-50 text-rose-600" }, middle: { label: "中", cls: "bg-amber-50 text-amber-700" }, low: { label: "低", cls: "bg-mist-soft text-ink/50" } } as const;
const KIND = { continuation: { label: "継続見込み", cls: "bg-violet-50 text-violet-700" }, new: { label: "新規見込み", cls: "bg-sky-50 text-sky-700" } } as const;
const STAFF = {
  ready: { label: "手当済", cls: "bg-emerald-50 text-emerald-700" },
  shortage: { label: "要手配", cls: "bg-rose-50 text-rose-600" },
  unknown: { label: "未定", cls: "bg-mist-soft text-ink/50" },
} as const;
const probBg = (p: number) => (p >= 70 ? "bg-emerald-500/80" : p >= 40 ? "bg-amber-500/80" : "bg-rose-400/80");

interface Group {
  key: string;
  confirmed: ConfirmedRow | null;
  forecasts: ForecastRow[];
}

/**
 * 原価管理の統合タイムライン。
 * 契約中(確定)・終了・継続見込み・新規見込みを同一表にマージし、
 * 案件に紐づけた見込みは同じ行に描画する。下段に月次の確定売上・加重見込み・必要人員。
 */
export function UnifiedTimeline({
  confirmed, forecasts, alerts, nowMonth, linkOptions,
}: {
  confirmed: ConfirmedRow[];
  forecasts: ForecastRow[];
  alerts: ForecastAlerts;
  nowMonth: string;
  linkOptions: LinkOption[];
}) {
  const [edit, setEdit] = useState<ForecastRow | "new" | null>(null);

  // 案件に紐づく見込みは同じグループ(行)へ、未紐づけは単独行
  const groups = useMemo<Group[]>(() => {
    const byOpp = new Map<string, Group>(confirmed.map((c) => [c.opportunityId, { key: c.opportunityId, confirmed: c, forecasts: [] }]));
    const standalone: Group[] = [];
    for (const f of forecasts) {
      const g = f.opportunityId ? byOpp.get(f.opportunityId) : undefined;
      if (g) g.forecasts.push(f);
      else standalone.push({ key: `f-${f.id}`, confirmed: null, forecasts: [f] });
    }
    const all = [...byOpp.values(), ...standalone];
    // 並び: 契約中 → 見込みあり → 開始前 → 終了のみ。同ランクは終了(または見込み終了)が近い順
    const rank = (g: Group) => (g.confirmed?.isActive ? 0 : g.forecasts.length > 0 ? 1 : g.confirmed?.isFuture ? 2 : 3);
    const lastMonth = (g: Group) => {
      const ends = [g.confirmed?.endMonth, ...g.forecasts.map((f) => f.endMonth)].filter((v): v is string => !!v);
      return ends.length ? ends.sort().slice(-1)[0] : "0000-00";
    };
    return all.sort((a, b) => rank(a) - rank(b) || lastMonth(b).localeCompare(lastMonth(a)));
  }, [confirmed, forecasts]);

  // 月ウィンドウ(全期間の和集合、過去は当月-6ヶ月まで、最大30列)
  const win = useMemo(() => {
    const set = new Set<string>([nowMonth]);
    for (const g of groups) {
      if (g.confirmed?.startMonth) set.add(g.confirmed.startMonth);
      if (g.confirmed?.endMonth) set.add(g.confirmed.endMonth);
      for (const c of g.confirmed?.monthly ?? []) set.add(c.month);
      for (const f of g.forecasts) { if (f.startMonth) set.add(f.startMonth); if (f.endMonth) set.add(f.endMonth); }
    }
    const sorted = [...set].sort();
    let start = sorted[0], end = sorted[sorted.length - 1];
    if (monthsBetween(start, end).length > 30) start = addMonths(nowMonth, -6) > start ? addMonths(nowMonth, -6) : start;
    return monthsBetween(start, end);
  }, [groups, nowMonth]);

  // 月次フッタ: 確定売上 / 見込み(加重) / 必要人員(うち要手配)
  const footer = useMemo(() => {
    const map = new Map(win.map((m) => [m, { confirmed: 0, weighted: 0, required: 0, shortage: 0 }]));
    for (const c of confirmed) for (const cell of c.monthly) {
      const x = map.get(cell.month); if (x) x.confirmed += cell.revenue;
    }
    for (const f of forecasts) for (const m of f.months) {
      const x = map.get(m); if (!x) continue;
      x.weighted += (f.monthlyAmount * f.probability) / 100;
      x.required += f.requiredHeadcount;
      if (f.staffingStatus === "shortage") x.shortage += f.requiredHeadcount;
    }
    return map;
  }, [confirmed, forecasts, win]);

  const COL = 62, NAME = 250;

  return (
    <div className="space-y-4">
      {/* アラート(採用/契約の先読み) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-black/[0.06] bg-white p-3">
          <div className="flex items-center gap-1.5 text-xs text-ink/45"><TrendingUp size={13} /> 今後6ヶ月の受注見込み(確度加重)</div>
          <div className="stat-value mt-1 text-teal-deep">{yen(alerts.next6Weighted)}</div>
          <div className="text-[11px] text-ink/40">素の見込み {yen(alerts.next6Raw)}</div>
        </div>
        <div className={`rounded-xl border p-3 ${alerts.shortageHeadcountNext3 > 0 ? "border-rose-200 bg-rose-50/50" : "border-black/[0.06] bg-white"}`}>
          <div className="flex items-center gap-1.5 text-xs text-ink/45"><Users size={13} /> 今後3ヶ月で要手配の人員</div>
          <div className={`stat-value mt-1 ${alerts.shortageHeadcountNext3 > 0 ? "text-rose-600" : "text-ink/80"}`}>{alerts.shortageHeadcountNext3}<span className="stat-unit">名</span></div>
          <div className="text-[11px] text-ink/40">要手配なら採用/契約を今すぐ</div>
        </div>
        <div className={`rounded-xl border p-3 ${alerts.actionItems.length > 0 ? "border-amber-200 bg-amber-50/50" : "border-black/[0.06] bg-white"}`}>
          <div className="flex items-center gap-1.5 text-xs text-ink/45"><TriangleAlert size={13} /> 要アクション(期限接近/開始間近)</div>
          <div className={`stat-value mt-1 ${alerts.actionItems.length > 0 ? "text-amber-700" : "text-ink/80"}`}>{alerts.actionItems.length}<span className="stat-unit">件</span></div>
          <div className="text-[11px] text-ink/40">手配未完で調整期限が近い見込み</div>
        </div>
      </div>

      {alerts.actionItems.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-amber-700">🚨 早めの調整が必要な見込み</div>
          {alerts.actionItems.slice(0, 8).map((f) => (
            <button key={f.id} type="button" onClick={() => setEdit(f)} className="flex w-full items-center gap-2 text-left text-xs rounded-lg px-2 py-1 hover:bg-white/70">
              <span className={`pill ${KIND[f.kind].cls} text-[10px] font-bold`}>{KIND[f.kind].label}</span>
              <span className="font-medium text-ink/80">{f.title}</span>
              <span className="text-ink/45">開始 {f.startMonth ? ymFull(f.startMonth) : "—"}</span>
              {f.arrangeDeadline && <span className="text-rose-600">調整期限 {f.arrangeDeadline}</span>}
              <span className="text-ink/55">必要 {f.requiredHeadcount || 0}名</span>
              <span className={`pill ${STAFF[f.staffingStatus].cls} text-[10px]`}>{STAFF[f.staffingStatus].label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 凡例 + 追加 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-[11px] text-ink/55 flex-wrap">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2.5 rounded-sm bg-teal-primary" />契約中</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2.5 rounded-sm bg-ink/35" />終了</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2.5 rounded-sm bg-teal-primary/45" />開始前(確定)</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2.5 rounded-sm border border-dashed border-ink/40 bg-emerald-500/70" />見込み(色=確度: 緑≥70/黄40-69/赤&lt;40)</span>
        </div>
        <button type="button" onClick={() => setEdit("new")} className="inline-flex items-center gap-1 rounded-lg bg-teal-primary px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-deep shrink-0">
          <Plus size={14} /> 見込みを追加
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="py-12 text-center">
          <CalendarRange size={28} className="mx-auto text-ink/25 mb-2" />
          <p className="text-sm text-ink/50">表示する案件・見込みがありません。</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-black/[0.06]">
          <div style={{ minWidth: NAME + win.length * COL }}>
            {/* ヘッダ月 */}
            <div className="flex sticky top-0 z-10 bg-mist-soft/60 backdrop-blur text-xs text-ink/50 border-b border-black/[0.06]">
              <div className="shrink-0 px-3 py-2 font-medium" style={{ width: NAME }}>案件 / 顧客</div>
              {win.map((m) => (
                <div key={m} className={`shrink-0 text-center py-2 border-l ${m === nowMonth ? "bg-teal-light/60 text-teal-deep font-bold" : Number(m.split("-")[1]) === 1 ? "border-black/10" : "border-black/[0.04]"}`} style={{ width: COL }}>
                  <div className="leading-tight">{ymLabel(m)}</div>
                  <div className="text-[10px] text-ink/35 leading-tight">{Number(m.split("-")[1]) === 1 || m === win[0] ? m.split("-")[0] : ""}</div>
                </div>
              ))}
            </div>

            {/* 行 */}
            <div className="divide-y divide-black/[0.04]">
              {groups.map((g) => {
                const c = g.confirmed;
                const revBy = new Map((c?.monthly ?? []).map((x) => [x.month, x.revenue]));
                const statusPill = c?.isActive
                  ? { t: "契約中", cls: "bg-teal-light text-teal-deep" }
                  : c?.isFuture
                    ? { t: "開始前", cls: "bg-mist-soft text-ink/50" }
                    : c?.isPast
                      ? { t: "終了", cls: "bg-ink/5 text-ink/45" }
                      : null;
                return (
                  <div key={g.key} className="flex row-hover items-stretch">
                    {/* 左: 案件情報 */}
                    <div className="shrink-0 px-3 py-2" style={{ width: NAME }}>
                      {c ? (
                        <Link href={`/app/projects/${c.opportunityId}`} className="block">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`pill ${PRIO[c.priority].cls} text-[10px] font-bold`}>{PRIO[c.priority].label}</span>
                            <span className="font-medium text-ink/90 text-sm truncate">{c.accountName}</span>
                            {statusPill && <span className={`pill ${statusPill.cls} text-[10px]`}>{statusPill.t}</span>}
                          </div>
                          <div className="text-[11px] text-teal-deep truncate">{c.oppName}</div>
                          <div className="text-[10px] text-ink/40">{yen(c.revenue)}・粗利率 {(c.grossRate * 100).toFixed(0)}%</div>
                        </Link>
                      ) : (
                        <div>
                          <div className="font-medium text-ink/90 text-sm truncate">{g.forecasts[0]?.title}</div>
                        </div>
                      )}
                      {/* 紐づく見込みのバッジ＋編集 */}
                      {g.forecasts.map((f) => (
                        <div key={f.id} className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={`pill ${KIND[f.kind].cls} text-[10px] font-bold`}>{KIND[f.kind].label} {f.probability}%</span>
                          <span className={`pill ${STAFF[f.staffingStatus].cls} text-[10px]`}>{STAFF[f.staffingStatus].label}{f.requiredHeadcount ? ` ${f.requiredHeadcount}名` : ""}</span>
                          {f.arrangeDeadline && <span className="text-[10px] text-rose-600">期限 {f.arrangeDeadline}</span>}
                          <button type="button" onClick={() => setEdit(f)} className="text-[10px] text-ink/40 hover:text-teal-deep inline-flex items-center gap-0.5"><Pencil size={10} />編集</button>
                        </div>
                      ))}
                    </div>

                    {/* 右: タイムラインセル */}
                    {win.map((m) => {
                      const confIn = !!c?.startMonth && !!c?.endMonth && m >= c.startMonth && m <= c.endMonth;
                      const fIns = g.forecasts.filter((f) => f.months.includes(m));
                      const overlap = confIn && fIns.length > 0;
                      const isConfStart = m === c?.startMonth, isConfEnd = m === c?.endMonth;
                      return (
                        <div key={m} className={`shrink-0 relative border-l ${m === nowMonth ? "bg-teal-light/25" : Number(m.split("-")[1]) === 1 ? "border-black/10" : "border-black/[0.03]"}`} style={{ width: COL, minHeight: 44 }}>
                          {confIn && c && (
                            <div
                              className={`absolute flex items-center justify-center text-[10px] font-semibold text-white ${c.isPast ? "bg-ink/35" : c.isFuture ? "bg-teal-primary/45" : "bg-teal-primary"}`}
                              style={{
                                top: 6, bottom: overlap ? "52%" : 6,
                                left: isConfStart ? 5 : 0, right: isConfEnd ? 5 : 0,
                                borderTopLeftRadius: isConfStart ? 6 : 0, borderBottomLeftRadius: isConfStart ? 6 : 0,
                                borderTopRightRadius: isConfEnd ? 6 : 0, borderBottomRightRadius: isConfEnd ? 6 : 0,
                              }}
                              title={`${c.oppName} ${m}${revBy.get(m) ? `: ${yen(revBy.get(m)!)}` : ""}`}
                            >
                              {yenShort(revBy.get(m) ?? 0)}
                            </div>
                          )}
                          {fIns.map((f, i) => {
                            const isS = m === f.startMonth, isE = m === f.endMonth;
                            return (
                              <div
                                key={f.id}
                                className={`absolute flex items-center justify-center text-[10px] font-semibold text-white border border-dashed border-white/70 ${probBg(f.probability)} ${f.staffingStatus === "shortage" ? "ring-1 ring-rose-400" : ""}`}
                                style={{
                                  top: overlap || i > 0 ? "52%" : 6, bottom: 6,
                                  left: isS ? 5 : 0, right: isE ? 5 : 0,
                                  borderTopLeftRadius: isS ? 6 : 0, borderBottomLeftRadius: isS ? 6 : 0,
                                  borderTopRightRadius: isE ? 6 : 0, borderBottomRightRadius: isE ? 6 : 0,
                                }}
                                title={`【見込み ${f.probability}%】${f.title} ${m}: 月額${yen(f.monthlyAmount)}`}
                              >
                                {yenShort(f.monthlyAmount)}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* フッタ: 月次サマリ */}
            <div className="border-t-2 border-black/10 bg-mist-soft/20 text-[11px]">
              <FooterRow label="確定売上(契約)" win={win} nowMonth={nowMonth} render={(m) => { const v = footer.get(m)!.confirmed; return v ? <span className="text-ink/75 font-semibold">{yenShort(v)}</span> : null; }} />
              <FooterRow label="見込み(確度加重)" win={win} nowMonth={nowMonth} render={(m) => { const v = footer.get(m)!.weighted; return v ? <span className="text-violet-600 font-semibold">{yenShort(v)}</span> : null; }} />
              <FooterRow label="合計" win={win} nowMonth={nowMonth} render={(m) => { const x = footer.get(m)!; const v = x.confirmed + x.weighted; return v ? <span className="text-teal-deep font-bold">{yenShort(v)}</span> : null; }} />
              <FooterRow label="必要人員（うち要手配）" win={win} nowMonth={nowMonth} render={(m) => { const x = footer.get(m)!; return x.required ? <span className="text-ink/70 font-semibold">{x.required}{x.shortage > 0 && <span className="text-rose-600">({x.shortage})</span>}</span> : null; }} />
            </div>
          </div>
        </div>
      )}

      {edit !== null && <ForecastForm forecast={edit === "new" ? null : edit} linkOptions={linkOptions} onClose={() => setEdit(null)} />}
    </div>
  );
}

function FooterRow({ label, win, nowMonth, render }: { label: string; win: string[]; nowMonth: string; render: (m: string) => React.ReactNode }) {
  const NAME = 250, COL = 62;
  return (
    <div className="flex border-t border-black/[0.05] first:border-t-0">
      <div className="shrink-0 px-3 py-1.5 font-medium text-ink/60" style={{ width: NAME }}>{label}</div>
      {win.map((m) => (
        <div key={m} className={`shrink-0 text-center py-1.5 border-l border-black/[0.03] ${m === nowMonth ? "bg-teal-light/30" : ""}`} style={{ width: COL }}>{render(m)}</div>
      ))}
    </div>
  );
}

/** 見込みの登録/編集フォーム。既存案件に紐づけると同一行にマージされる。 */
function ForecastForm({ forecast, linkOptions, onClose }: { forecast: ForecastRow | null; linkOptions: LinkOption[]; onClose: () => void }) {
  const [pending, start] = useTransition();
  const f = forecast;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => { await saveDeliveryForecastAction(fd); onClose(); });
  };
  const remove = () => {
    if (!f) return;
    const fd = new FormData(); fd.set("id", f.id);
    start(async () => { await deleteDeliveryForecastAction(fd); onClose(); });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-ink/90">{f ? "見込みを編集" : "見込みを追加"}</h3>
          <button type="button" onClick={onClose} className="text-ink/40 hover:text-ink/70"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3 text-sm">
          {f && <input type="hidden" name="id" value={f.id} />}
          <label className="block">
            <span className="text-xs text-ink/50">紐づけ案件（継続・延長は元案件を選ぶと同じ行に表示されます）</span>
            <select name="opportunity_id" defaultValue={f?.opportunityId ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5">
              <option value="">紐づけない（新規の見込み）</option>
              {linkOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">区分</span>
              <select name="kind" defaultValue={f?.kind ?? "continuation"} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5">
                <option value="continuation">継続 / 延長</option>
                <option value="new">新規見込み</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">受注確度（%）</span>
              <input name="probability" type="number" min={0} max={100} defaultValue={f?.probability ?? 50} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-ink/50">タイトル（空欄なら「案件名（継続）」を自動設定）</span>
            <input name="title" defaultValue={f?.title ?? ""} placeholder="例: 日本トムソン(継続)" className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">開始月</span>
              <input name="start_month" type="month" defaultValue={f?.startMonth ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">終了月</span>
              <input name="end_month" type="month" defaultValue={f?.endMonth ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">金額（円）</span>
              <input name="amount" type="number" min={0} step={10000} defaultValue={f?.amount ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">金額の単位</span>
              <select name="amount_basis" defaultValue={f?.amountBasis ?? "monthly"} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5">
                <option value="monthly">月額</option>
                <option value="total">総額</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">必要人数（同時稼働）</span>
              <input name="required_headcount" type="number" min={0} step={0.5} defaultValue={f?.requiredHeadcount ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">人員手配</span>
              <select name="staffing_status" defaultValue={f?.staffingStatus ?? "unknown"} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5">
                <option value="unknown">未定</option>
                <option value="shortage">要手配</option>
                <option value="ready">手当済</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-ink/50">契約/採用の調整期限</span>
            <input name="arrange_deadline" type="date" defaultValue={f?.arrangeDeadline ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-ink/50">メモ</span>
            <textarea name="notes" rows={2} defaultValue={f?.notes ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
          </label>
          <div className="flex items-center justify-between pt-1">
            {f ? (
              <button type="button" onClick={remove} disabled={pending} className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700"><Trash2 size={13} /> 削除</button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-ghost text-xs">キャンセル</button>
              <button type="submit" disabled={pending} className="rounded-lg bg-teal-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-deep disabled:opacity-50">{pending ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
