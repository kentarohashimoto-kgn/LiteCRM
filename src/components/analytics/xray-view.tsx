"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, ScanLine, AlertTriangle, CheckCircle2, Stethoscope } from "lucide-react";
import { fetchXrayAction } from "@/server/actions/xray";
import {
  diagnose,
  prescriptions,
  chainRates,
  existingEngine,
  stockDiagnosis,
  MIN_DENOM,
  EXIST_REF,
  type XrayData,
  type Health,
  type NodeKey,
  type NodeDiag,
} from "@/lib/xray";
import { cn, formatYen } from "@/lib/utils";

/* ============ 期間ユーティリティ ============ */

function pad(n: number): string { return String(n).padStart(2, "0"); }
function iso(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addMonths(d: Date, m: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addYears(d: Date, y: number): Date { const x = new Date(d); x.setFullYear(x.getFullYear() + y); return x; }

export interface XrayRange { start: string; end: string } // end排他的

const PRESETS: { key: string; label: string; range: () => XrayRange }[] = [
  { key: "this_month", label: "今月", range: () => { const t = new Date(); return { start: iso(new Date(t.getFullYear(), t.getMonth(), 1)), end: iso(addDays(t, 1)) }; } },
  { key: "last_month", label: "先月", range: () => { const t = new Date(); return { start: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), end: iso(new Date(t.getFullYear(), t.getMonth(), 1)) }; } },
  { key: "3m", label: "過去3ヶ月", range: () => { const t = addDays(new Date(), 1); return { start: iso(addMonths(t, -3)), end: iso(t) }; } },
  { key: "6m", label: "過去6ヶ月", range: () => { const t = addDays(new Date(), 1); return { start: iso(addMonths(t, -6)), end: iso(t) }; } },
  { key: "12m", label: "過去12ヶ月", range: () => { const t = addDays(new Date(), 1); return { start: iso(addMonths(t, -12)), end: iso(t) }; } },
  { key: "all", label: "全期間", range: () => ({ start: "2020-01-01", end: iso(addDays(new Date(), 1)) }) },
];

type CmpMode = "prev" | "yoy" | "none";

export function cmpRangeOf(r: XrayRange, mode: CmpMode): XrayRange {
  const s = new Date(r.start + "T00:00:00");
  const e = new Date(r.end + "T00:00:00");
  if (mode === "yoy") return { start: iso(addYears(s, -1)), end: iso(addYears(e, -1)) };
  if (mode === "none") return { start: r.start, end: r.start }; // 空区間=比較なし
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000));
  return { start: iso(addDays(s, -days)), end: r.start };
}

function fmtRangeJp(r: XrayRange): string {
  const s = new Date(r.start + "T00:00:00");
  const e = addDays(new Date(r.end + "T00:00:00"), -1);
  return `${s.getFullYear()}/${s.getMonth() + 1}/${s.getDate()} 〜 ${e.getFullYear()}/${e.getMonth() + 1}/${e.getDate()}`;
}

/* ============ 表示ユーティリティ ============ */

function pctStr(v: number | null): string { return v == null ? "—" : `${(v * 100).toFixed(1)}%`; }
function num(v: number): string { return v.toLocaleString("ja-JP"); }

const HEALTH_CARD: Record<Health, string> = {
  good: "border-teal-primary/50 bg-teal-light/30",
  warn: "border-amber-400/70 bg-amber-50",
  bad: "border-rose-400/80 bg-rose-50",
  na: "border-black/10 bg-mist-soft/40",
};
const HEALTH_TEXT: Record<Health, string> = {
  good: "text-teal-deep", warn: "text-amber-700", bad: "text-rose-600", na: "text-ink/40",
};

function DeltaArrow({ changePct }: { changePct: number | null }) {
  if (changePct == null) return <span className="text-[10px] text-ink/30">比較なし</span>;
  const up = changePct >= 0;
  return (
    <span className={cn("text-[11px] font-semibold tabular-nums", up ? "text-teal-deep" : "text-rose-500")}>
      {up ? "▲" : "▼"} {Math.abs(changePct * 100).toFixed(1)}%
    </span>
  );
}

function Spark({ data, color = "#0E8A80" }: { data: number[]; color?: string }) {
  if (data.length < 2 || data.every((v) => v === 0)) return <div className="h-[20px]" />;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 64},${18 - ((v - min) / range) * 16}`).join(" ");
  return (
    <svg width="64" height="20" viewBox="0 0 64 20" className="opacity-80" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="64" cy={18 - ((data[data.length - 1] - min) / range) * 16} r="2" fill={color} />
    </svg>
  );
}

/* ============ チェーンのノード ============ */

function CountNode({ label, value, cmpValue, series, target, format, selected, onClick }: {
  label: string; value: number; cmpValue: number | null; series: number[];
  target?: number | null; format?: (v: number) => string;
  selected: boolean; onClick: () => void;
}) {
  const fmt = format ?? num;
  const changePct = cmpValue != null && cmpValue > 0 ? (value - cmpValue) / cmpValue : null;
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "shrink-0 w-[128px] rounded-xl border bg-white px-3 py-2.5 text-left transition-shadow hover:shadow-md",
        selected ? "border-teal-primary ring-2 ring-teal-primary/30" : "border-black/10",
      )}>
      <div className="text-[10.5px] font-semibold text-ink/45">{label}</div>
      <div className="text-lg font-bold text-ink tabular-nums leading-tight mt-0.5">{fmt(value)}</div>
      <div className="flex items-center justify-between mt-1">
        <DeltaArrow changePct={changePct} />
        <Spark data={series} />
      </div>
      {target != null && target > 0 && (
        <div className="mt-1.5">
          <div className="h-1 rounded-full bg-mist-soft overflow-hidden">
            <div className={cn("h-full rounded-full", value >= target ? "bg-teal-primary" : "bg-amber-400")}
              style={{ width: `${Math.min(100, (value / target) * 100)}%` }} />
          </div>
          <div className="text-[9.5px] text-ink/40 mt-0.5 tabular-nums">目標 {fmt(target)} ({Math.round((value / target) * 100)}%)</div>
        </div>
      )}
    </button>
  );
}

function RateNode({ diag, symbol, isWorst, selected, onClick, format }: {
  diag: NodeDiag; symbol: string; isWorst: boolean; selected: boolean; onClick: () => void;
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => pctStr(v));
  return (
    <div className="shrink-0 flex items-center">
      <div className="w-4 h-px bg-black/15" />
      <button type="button" onClick={onClick}
        className={cn(
          "rounded-xl border-2 px-2.5 py-2 min-w-[104px] text-center transition-shadow hover:shadow-md",
          HEALTH_CARD[diag.health],
          selected && "ring-2 ring-teal-primary/40",
          isWorst && "ring-2 ring-rose-400 motion-safe:animate-pulse",
        )}>
        <div className={cn("text-[10px] font-bold", HEALTH_TEXT[diag.health])}>{symbol} {diag.label}</div>
        <div className={cn("text-base font-bold tabular-nums", HEALTH_TEXT[diag.health])}>
          {diag.cur == null ? "—" : fmt(diag.cur)}
        </div>
        <div className="flex items-center justify-center gap-1">
          <DeltaArrow changePct={diag.changePct} />
        </div>
        {diag.health === "na" && diag.denom < MIN_DENOM && (
          <div className="text-[9px] text-ink/35 mt-0.5">データ不足・判定保留</div>
        )}
        {diag.impact > 0 && (
          <div className={cn("mt-1 rounded-md px-1 py-0.5 text-[9.5px] font-bold",
            diag.health === "bad" ? "bg-rose-500 text-white" : "bg-amber-400 text-white")}>
            改善で +{formatYen(diag.impact)}
          </div>
        )}
      </button>
      <div className="w-4 h-px bg-black/15" />
    </div>
  );
}

/* ============ 月次バー(ドリルダウン下部) ============ */

function MonthlyBars({ series, pick, format, color = "bg-teal-primary" }: {
  series: XrayData["monthly"]; pick: (m: XrayData["monthly"][number]) => number;
  format: (v: number) => string; color?: string;
}) {
  const vals = series.map(pick);
  const max = Math.max(...vals, 1);
  return (
    <div>
      <div className="flex items-end gap-1.5 h-24">
        {series.map((m, i) => (
          <div key={m.ym} className="flex-1 flex flex-col items-center gap-0.5" title={`${m.ym}: ${format(vals[i])}`}>
            <span className="text-[8.5px] text-ink/45 tabular-nums">{vals[i] > 0 ? format(vals[i]) : ""}</span>
            <div className={cn("w-full rounded-t", color)} style={{ height: `${Math.max(2, (vals[i] / max) * 72)}px` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {series.map((m) => (
          <div key={m.ym} className="flex-1 text-center text-[8.5px] text-ink/35 tabular-nums">{m.ym.slice(2).replace("-", "/")}</div>
        ))}
      </div>
    </div>
  );
}

/* ============ メイン ============ */

export function XrayView({ initialData, initialRange }: { initialData: XrayData | null; initialRange: XrayRange }) {
  const [presetKey, setPresetKey] = useState("3m");
  const [range, setRange] = useState<XrayRange>(initialRange);
  const [cmpMode, setCmpMode] = useState<CmpMode>("prev");
  const [customStart, setCustomStart] = useState(initialRange.start);
  const [customEnd, setCustomEnd] = useState(initialRange.end);
  const [data, setData] = useState<XrayData | null>(initialData);
  const [selected, setSelected] = useState<NodeKey | null>(null);
  const [pending, startTransition] = useTransition();

  function reload(r: XrayRange, mode: CmpMode) {
    const c = cmpRangeOf(r, mode);
    startTransition(async () => {
      const d = await fetchXrayAction({ start: r.start, end: r.end, cmpStart: c.start, cmpEnd: c.end });
      if (d) setData(d);
    });
  }
  function applyPreset(key: string) {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    const r = p.range();
    setPresetKey(key); setRange(r); setCustomStart(r.start); setCustomEnd(r.end);
    reload(r, cmpMode);
  }
  function applyCustom() {
    if (!customStart || !customEnd || customStart >= customEnd) return;
    const r = { start: customStart, end: customEnd };
    setPresetKey("custom"); setRange(r);
    reload(r, cmpMode);
  }
  function applyCmp(mode: CmpMode) {
    setCmpMode(mode);
    reload(range, mode);
  }

  const view = useMemo(() => {
    if (!data) return null;
    const nodes = diagnose(data.cur, data.cmp);
    const byKey = Object.fromEntries(nodes.map((n) => [n.key, n])) as Record<NodeKey, NodeDiag>;
    const rx = prescriptions(nodes, data.cur);
    const worst = nodes.filter((n) => n.health === "bad" && n.impact > 0).sort((a, b) => b.impact - a.impact)[0]?.key ?? null;
    const rc = chainRates(data.cur);
    const engine = existingEngine(data.base);
    const periodMonths = Math.max(1, Math.round(
      (new Date(range.end + "T00:00:00").getTime() - new Date(range.start + "T00:00:00").getTime()) / (86400000 * 30.4),
    ));
    const stock = stockDiagnosis(data.cur, data.base, periodMonths);
    return { nodes, byKey, rx, worst, rc, engine, stock };
  }, [data, range]);

  if (!data || !view) {
    return <div className="card card-pad text-sm text-ink/50">データを取得できませんでした。再読み込みしてください。</div>;
  }

  const { cur, cmp, targets, monthly } = data;
  const cmpOn = cmpMode !== "none";
  const newBooked = cur.revenue_booked - cur.revenue_exist;
  const fuRate = cur.fu_due > 0 ? cur.fu_held / cur.fu_due : null;

  return (
    <div className="space-y-4">

      {/* 期間セレクタ */}
      <div className="card card-pad space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-ink/50 mr-1">分析期間</span>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => applyPreset(p.key)}
              className={cn("rounded-lg px-2.5 py-1 text-xs font-medium border",
                presetKey === p.key ? "bg-teal-primary text-white border-teal-primary" : "bg-white text-ink/60 border-black/10 hover:bg-mist-soft")}>
              {p.label}
            </button>
          ))}
          <span className="mx-1 text-ink/20">|</span>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="input !w-auto !py-1 !px-2 text-xs" aria-label="開始日" />
          <span className="text-xs text-ink/40">〜</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="input !w-auto !py-1 !px-2 text-xs" aria-label="終了日(この日を含まない)" />
          <button type="button" onClick={applyCustom} className="rounded-lg px-2.5 py-1 text-xs font-medium border border-teal-primary/40 text-teal-deep hover:bg-teal-light/40">適用</button>
          {pending && <Loader2 size={14} className="animate-spin text-teal-deep ml-1" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-black/[0.04]">
          <span className="text-xs font-semibold text-ink/50 mr-1">比較対象</span>
          {([["prev", "直前の同期間"], ["yoy", "前年同期"], ["none", "比較なし"]] as [CmpMode, string][]).map(([m, label]) => (
            <button key={m} type="button" onClick={() => applyCmp(m)}
              className={cn("rounded-lg px-2.5 py-1 text-xs font-medium border",
                cmpMode === m ? "bg-ink text-white border-ink" : "bg-white text-ink/60 border-black/10 hover:bg-mist-soft")}>
              {label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-ink/45 tabular-nums">
            対象: {fmtRangeJp(range)}{cmpOn && ` ／ 比較: ${fmtRangeJp(cmpRangeOf(range, cmpMode))}`}
          </span>
        </div>
      </div>

      {/* 処方箋 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {view.rx.length === 0 ? (
          <div className="md:col-span-3 card card-pad flex items-center gap-3 border-teal-primary/40 bg-teal-light/20">
            <CheckCircle2 size={20} className="text-teal-deep shrink-0" />
            <div>
              <div className="text-sm font-bold text-teal-deep">大きな悪化は検出されませんでした</div>
              <div className="text-xs text-ink/55 mt-0.5">比較期間に対して-10%を超える悪化ノードはありません。期間を変えると別の傾向が見えることがあります。</div>
            </div>
          </div>
        ) : view.rx.map((p, i) => (
          <div key={p.key} className={cn("card card-pad space-y-1.5 border-2",
            p.severity === "bad" ? "border-rose-300 bg-rose-50/50" : "border-amber-300 bg-amber-50/50")}>
            <div className="flex items-center gap-1.5">
              <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold",
                p.severity === "bad" ? "bg-rose-500" : "bg-amber-500")}>{i + 1}</span>
              <AlertTriangle size={13} className={p.severity === "bad" ? "text-rose-500" : "text-amber-600"} />
              <span className={cn("text-[10px] font-bold uppercase tracking-wide", p.severity === "bad" ? "text-rose-500" : "text-amber-600")}>
                {p.severity === "bad" ? "要対処" : "注意"}
              </span>
            </div>
            <div className="text-[13px] font-bold text-ink leading-snug">{p.title}</div>
            <p className="text-[11.5px] text-ink/60 leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>

      {/* 成果サマリ(計上ベース) */}
      <div className="card card-pad">
        <div className="text-xs font-bold text-ink/45 mb-2.5">① 成果 — この期間に受注した売上（計上ベース）</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-[11px] text-ink/45">期間売上</div>
            <div className="text-xl font-bold stat-accent tabular-nums">{formatYen(cur.revenue_booked)}</div>
            {cmpOn && <DeltaArrow changePct={cmp.revenue_booked > 0 ? (cur.revenue_booked - cmp.revenue_booked) / cmp.revenue_booked : null} />}
            {targets && targets.amount > 0 && (
              <div className="mt-1.5">
                <div className="h-1.5 rounded-full bg-mist-soft overflow-hidden">
                  <div className={cn("h-full rounded-full", cur.revenue_booked >= targets.amount ? "bg-teal-primary" : "bg-amber-400")}
                    style={{ width: `${Math.min(100, (cur.revenue_booked / targets.amount) * 100)}%` }} />
                </div>
                <div className="text-[10px] text-ink/45 mt-0.5 tabular-nums">
                  目標 {formatYen(targets.amount)}（達成率 {Math.round((cur.revenue_booked / targets.amount) * 100)}%）
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-ink/45">受注件数</div>
            <div className="text-xl font-bold text-ink tabular-nums">{num(cur.won_booked)}<span className="text-xs font-normal text-ink/40 ml-0.5">件</span></div>
            {cmpOn && <DeltaArrow changePct={cmp.won_booked > 0 ? (cur.won_booked - cmp.won_booked) / cmp.won_booked : null} />}
            {targets && targets.deals > 0 && <div className="text-[10px] text-ink/45 mt-0.5 tabular-nums">目標 {targets.deals}件</div>}
          </div>
          <div>
            <div className="text-[11px] text-ink/45">新規 / 既存の内訳</div>
            <div className="text-sm font-bold text-ink tabular-nums mt-1">
              新規 {formatYen(newBooked)} <span className="text-ink/30 mx-0.5">／</span> 既存 {formatYen(cur.revenue_exist)}
            </div>
            {cur.revenue_booked > 0 && (
              <div className="h-1.5 rounded-full bg-mist-soft overflow-hidden mt-1.5 flex">
                <div className="h-full bg-teal-primary" style={{ width: `${(newBooked / cur.revenue_booked) * 100}%` }} />
                <div className="h-full bg-violet-400" style={{ width: `${(cur.revenue_exist / cur.revenue_booked) * 100}%` }} />
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-ink/45">平均受注単価（計上）</div>
            <div className="text-xl font-bold text-ink tabular-nums">{cur.won_booked > 0 ? formatYen(cur.revenue_booked / cur.won_booked) : "—"}</div>
            {cmpOn && cmp.won_booked > 0 && cur.won_booked > 0 && (
              <DeltaArrow changePct={((cur.revenue_booked / cur.won_booked) - (cmp.revenue_booked / cmp.won_booked)) / (cmp.revenue_booked / cmp.won_booked)} />
            )}
          </div>
        </div>
      </div>

      {/* ファネルチェーン(コホート) */}
      <div className="card card-pad">
        <div className="flex items-baseline justify-between flex-wrap gap-1 mb-3">
          <div className="text-xs font-bold text-ink/45">② レントゲン — この期間に獲得したリード・アポの行方（コホート基準）。各カードをクリックで内訳</div>
          <div className="text-[10px] text-ink/35">売上 = リード × アポ獲得率 × 商談実施率 × 受注率 × 平均単価</div>
        </div>
        <div className="overflow-x-auto pb-1.5">
          <div className="flex items-center min-w-max">
            <CountNode label="リード獲得" value={cur.leads} cmpValue={cmpOn ? cmp.leads : null}
              series={monthly.map((m) => m.leads)} target={targets?.leads || null}
              selected={selected === "leads"} onClick={() => setSelected(selected === "leads" ? null : "leads")} />
            <RateNode diag={view.byKey.apptRate} symbol="×" isWorst={view.worst === "apptRate"}
              selected={selected === "apptRate"} onClick={() => setSelected(selected === "apptRate" ? null : "apptRate")} />
            <CountNode label="アポ獲得" value={cur.appts} cmpValue={cmpOn ? cmp.appts : null}
              series={monthly.map((m) => m.appts)} target={targets?.appointments || null}
              selected={selected === "apptRate"} onClick={() => setSelected(selected === "apptRate" ? null : "apptRate")} />
            <RateNode diag={view.byKey.meetRate} symbol="×" isWorst={view.worst === "meetRate"}
              selected={selected === "meetRate"} onClick={() => setSelected(selected === "meetRate" ? null : "meetRate")} />
            <CountNode label="商談実施" value={cur.meets} cmpValue={cmpOn ? cmp.meets : null}
              series={[]}
              selected={selected === "meetRate"} onClick={() => setSelected(selected === "meetRate" ? null : "meetRate")} />
            <RateNode diag={view.byKey.winRate} symbol="×" isWorst={view.worst === "winRate"}
              selected={selected === "winRate"} onClick={() => setSelected(selected === "winRate" ? null : "winRate")} />
            <CountNode label="受注" value={cur.won} cmpValue={cmpOn ? cmp.won : null}
              series={monthly.map((m) => m.won)} target={targets?.deals || null}
              selected={selected === "winRate"} onClick={() => setSelected(selected === "winRate" ? null : "winRate")} />
            <RateNode diag={view.byKey.avgPrice} symbol="×" isWorst={view.worst === "avgPrice"} format={(v) => formatYen(v)}
              selected={selected === "avgPrice"} onClick={() => setSelected(selected === "avgPrice" ? null : "avgPrice")} />
            <CountNode label="売上(このコホート)" value={cur.revenue} cmpValue={cmpOn ? cmp.revenue : null}
              series={monthly.map((m) => m.revenue)} format={(v) => formatYen(v)}
              selected={selected === "avgPrice"} onClick={() => setSelected(selected === "avgPrice" ? null : "avgPrice")} />
          </div>
        </div>
        {/* 滞留チップ */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-black/[0.04]">
          <span className="text-[10.5px] text-ink/40 font-semibold">未実施の内訳:</span>
          <span className="pill bg-mist-soft text-ink/55 text-[10px]">アポ予定 {cur.st_appt}</span>
          <span className={cn("pill text-[10px]", cur.st_resched > 0 ? "bg-amber-100 text-amber-700" : "bg-mist-soft text-ink/40")}>リスケ {cur.st_resched}</span>
          <span className={cn("pill text-[10px]", cur.st_pending > 0 ? "bg-amber-100 text-amber-700" : "bg-mist-soft text-ink/40")}>調整中 {cur.st_pending}</span>
          <span className={cn("pill text-[10px]", cur.st_cancel > 0 ? "bg-rose-100 text-rose-600" : "bg-mist-soft text-ink/40")}>キャンセル {cur.st_cancel}</span>
          <span className="ml-auto text-[10px] text-ink/35">※ 直近の期間ほど「まだ結果が出ていない」案件を含むため率は低く出ます</span>
        </div>
      </div>

      {/* 既存深耕(研修後FU)ミニチェーン */}
      <div className="card card-pad">
        <div className="text-xs font-bold text-ink/45 mb-2.5">③ 既存深耕 — 研修後フォローアップからのアップセル（期間内に期日を迎えた面談）</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-lg border border-black/10 bg-white px-3 py-1.5">FU期日 <b className="tabular-nums">{cur.fu_due}</b>件</span>
          <span className="text-ink/30">→</span>
          <span className={cn("rounded-lg border-2 px-3 py-1.5 font-semibold",
            fuRate == null ? "border-black/10 bg-mist-soft/40 text-ink/40"
              : fuRate >= 0.7 ? HEALTH_CARD.good + " " + HEALTH_TEXT.good
              : fuRate >= 0.4 ? HEALTH_CARD.warn + " " + HEALTH_TEXT.warn
              : HEALTH_CARD.bad + " " + HEALTH_TEXT.bad)}>
            実施率 {fuRate == null ? "—" : `${Math.round(fuRate * 100)}%`}（{cur.fu_held}件実施）
          </span>
          <span className="text-ink/30">→</span>
          <span className="rounded-lg border border-black/10 bg-white px-3 py-1.5">提案 <b className="tabular-nums">{cur.fu_proposals}</b>件</span>
          <span className="text-ink/30">→</span>
          <span className="rounded-lg border border-black/10 bg-white px-3 py-1.5">アップセル <b className="tabular-nums">{cur.fu_upsell}</b>件</span>
          <span className="text-ink/30">＝</span>
          <span className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-violet-700 font-semibold">既存売上 {formatYen(cur.revenue_exist)}</span>
        </div>
      </div>

      {/* ④ 既存顧客エンジン: あるべき数式と現在地(データが無くても型と参考値を提示) */}
      <div className="card card-pad border-violet-200">
        <div className="flex items-baseline justify-between flex-wrap gap-1 mb-3">
          <div className="text-xs font-bold text-violet-700">④ 既存顧客エンジン — 本来あるべき数式と現在地（リピート・横展開の強化ポイント）</div>
          <div className="text-[10px] text-ink/35">既存売上 = FU対象顧客 × 年{EXIST_REF.cyclesPerYear}接点 × FU実施率 × 提案率 × 成約率 × 単価</div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 左: 各因数の現在値 vs 参考値 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 font-bold text-violet-700 tabular-nums">母数 {view.engine.baseCount}社</span>
              <span className="text-[11px] text-ink/45">研修実施済み＝フォロー対象。ここは既に資産としてあります</span>
            </div>
            {view.engine.steps.map((s) => (
              <div key={s.key}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-ink/70">{s.label}</span>
                  <span className="tabular-nums">
                    <b className={cn(s.measurable && s.cur != null && s.cur >= s.ref * 0.8 ? "text-teal-deep" : "text-rose-500")}>
                      {s.measurable && s.cur != null ? `${(s.cur * 100).toFixed(0)}%` : "実績なし(0%)"}
                    </b>
                    <span className="text-ink/40"> ／ 参考値 {(s.ref * 100).toFixed(0)}%</span>
                  </span>
                </div>
                <div className="relative h-2.5 rounded-full bg-mist-soft overflow-hidden mt-1">
                  <div className={cn("h-full rounded-full", s.cur != null && s.cur >= s.ref * 0.8 ? "bg-teal-primary" : "bg-rose-400")}
                    style={{ width: `${Math.min(100, (s.cur ?? 0) * 100)}%` }} />
                  {/* 参考値マーカー */}
                  <div className="absolute top-0 bottom-0 w-0.5 bg-violet-500" style={{ left: `${s.ref * 100}%` }} title={`参考値 ${(s.ref * 100).toFixed(0)}%`} />
                </div>
              </div>
            ))}
            <p className="text-[10.5px] text-ink/40 leading-relaxed">
              参考値は一般的なBtoB研修・コンサル事業の目安。紫の線が「あるべき水準」。実測が貯まったら自社基準に更新します。
            </p>
          </div>
          {/* 右: ポテンシャルとのギャップ */}
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 flex flex-col justify-center gap-2.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-ink/50">現在の実績(アップセル)</div>
                <div className="text-2xl font-bold text-rose-500 tabular-nums">{view.engine.actualUpsells}<span className="text-sm font-normal">件</span></div>
              </div>
              <div>
                <div className="text-[11px] text-ink/50">参考値で回した場合(年間)</div>
                <div className="text-2xl font-bold text-violet-700 tabular-nums">
                  約{view.engine.potentialDealsYear.toFixed(1)}<span className="text-sm font-normal">件</span>
                </div>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-ink/50">年間ポテンシャル売上(単価は初回受注の{Math.round(EXIST_REF.upsellPriceRatio * 100)}%と仮定)</div>
              <div className="text-2xl font-bold text-violet-700">{formatYen(view.engine.potentialRevenueYear)}</div>
            </div>
            <div className="rounded-lg bg-white border border-violet-200 px-3 py-2 text-[11.5px] text-ink/70 leading-relaxed">
              <b className="text-violet-700">ここが強化ポイントです。</b>
              新規獲得に比べ、既存{view.engine.baseCount}社へのフォローは獲得コストゼロで売上を生みます。
              まずは<b>FU面談の日程設定</b>から。エンジンが回り始めると、この欄が実測値に置き換わっていきます。
            </div>
          </div>
        </div>
      </div>

      {/* ⑤ サブスク・ストック売上比率 */}
      <div className="card card-pad border-indigo-200">
        <div className="flex items-baseline justify-between flex-wrap gap-1 mb-3">
          <div className="text-xs font-bold text-indigo-700">⑤ サブスク・ストック売上 — 全体比率のあるべき姿（目標帯 {Math.round(view.stock.targetMin * 100)}〜{Math.round(view.stock.targetMax * 100)}%）</div>
          <div className="text-[10px] text-ink/35">ストック＝顧問・月額・保守等の継続課金型。景気変動に強い売上基盤</div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 左: 比率バー(選択期間/全期間) + 目標帯 */}
          <div className="space-y-4">
            {([["選択期間", view.stock.share, cur.revenue_stock, cur.revenue_booked], ["全期間", view.stock.shareAll, data.base.revenue_stock_all, data.base.revenue_all]] as [string, number | null, number, number][]).map(([label, share, stockYen, totalYen]) => (
              <div key={label}>
                <div className="flex items-baseline justify-between text-xs mb-1">
                  <span className="font-semibold text-ink/70">{label}</span>
                  <span className="tabular-nums">
                    <b className={cn(share != null && share >= view.stock.targetMin ? "text-teal-deep" : "text-rose-500")}>
                      ストック {share == null ? "—" : `${(share * 100).toFixed(1)}%`}
                    </b>
                    <span className="text-ink/40"> ({formatYen(stockYen)} / {formatYen(totalYen)})</span>
                  </span>
                </div>
                <div className="relative h-4 rounded-full bg-teal-light/50 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-l-full" style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }} />
                  {/* 目標帯 30-50% */}
                  <div className="absolute top-0 bottom-0 border-x-2 border-indigo-700/50 bg-indigo-700/10"
                    style={{ left: `${view.stock.targetMin * 100}%`, width: `${(view.stock.targetMax - view.stock.targetMin) * 100}%` }}
                    title={`目標帯 ${Math.round(view.stock.targetMin * 100)}〜${Math.round(view.stock.targetMax * 100)}%`} />
                </div>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-black/10 bg-white px-2 py-2">
                <div className="text-[10px] text-ink/45">現在のMRR</div>
                <div className="text-sm font-bold tabular-nums">{formatYen(view.stock.mrr)}</div>
                <div className="text-[9px] text-ink/35">継続契約 {view.stock.recurringContracts}件</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-white px-2 py-2">
                <div className="text-[10px] text-ink/45">目指す月額ストック</div>
                <div className="text-sm font-bold tabular-nums text-indigo-700">{formatYen(view.stock.mrrTargetMonthly)}</div>
                <div className="text-[9px] text-ink/35">月商×{Math.round(view.stock.targetMin * 100)}%</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-white px-2 py-2">
                <div className="text-[10px] text-ink/45">期間の不足額</div>
                <div className="text-sm font-bold tabular-nums text-rose-500">{view.stock.gapYenToMin > 0 ? formatYen(view.stock.gapYenToMin) : "達成"}</div>
                <div className="text-[9px] text-ink/35">目標下限まで</div>
              </div>
            </div>
          </div>
          {/* 右: アドバイス */}
          <div className="space-y-2">
            {view.stock.advices.length === 0 ? (
              <div className="rounded-xl border border-teal-primary/40 bg-teal-light/20 p-3 text-sm text-teal-deep font-semibold">
                ストック比率は目標帯に到達しています。解約率・更新率の管理に軸足を移しましょう。
              </div>
            ) : view.stock.advices.map((a, i) => (
              <div key={i} className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                <div className="text-[12px] font-bold text-indigo-700 mb-0.5">💡 {a.title}</div>
                <p className="text-[11.5px] text-ink/65 leading-relaxed">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ドリルダウン */}
      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-3">
          <Stethoscope size={15} className="text-teal-deep" />
          <span className="text-sm font-bold text-ink">
            {selected == null ? "12ヶ月の推移（カードをクリックすると内訳に切り替わります）" : `内訳: ${view.byKey[selected]?.label ?? ""}`}
          </span>
          {selected != null && (
            <button type="button" onClick={() => setSelected(null)} className="ml-auto text-xs text-ink/40 hover:text-ink">× 閉じる</button>
          )}
        </div>
        <DrillPanel selected={selected} data={data} />
      </div>

      <p className="text-[11px] text-ink/40 leading-relaxed">
        ※ ②のファネルは<b>コホート基準</b>（その期間に獲得したリード・アポが現時点でどこまで進んだか）。獲得日はアポ獲得日→初回商談日→登録日の順で判定します。
        ①の成果は<b>計上基準</b>（受注予定日がその期間内の受注）。
        判定は比較期間との差で行い、-10%超の悪化で注意（黄）、-25%超で要対処（赤）。分母{MIN_DENOM}件未満のノードはデータ不足として判定を保留します。
        「改善で+¥」は、その率だけを比較期間の水準に戻した場合の売上増分（機会損失額）です。
      </p>
    </div>
  );
}

/* ============ ドリルダウンパネル ============ */

function DrillPanel({ selected, data }: { selected: NodeKey | null; data: XrayData }) {
  const { monthly, exhibitions, reps, products } = data;

  if (selected === "leads" || selected === "apptRate") {
    const rows = [...exhibitions].map((e) => ({ ...e, rate: e.leads && e.leads > 0 ? (e.appts ?? 0) / e.leads : null }));
    if (selected === "apptRate") rows.sort((a, b) => (a.rate ?? 99) - (b.rate ?? 99));
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-black/[0.06]">
              <th className="th">展示会・イベント</th><th className="th text-right">リード</th><th className="th text-right">アポ</th><th className="th text-right">アポ率</th>
            </tr></thead>
            <tbody className="divide-y divide-black/[0.04]">
              {rows.map((e) => (
                <tr key={e.name} className="row-hover">
                  <td className="td text-xs max-w-[200px] truncate" title={e.name}>{e.name}</td>
                  <td className="td text-right tabular-nums">{e.leads}</td>
                  <td className="td text-right tabular-nums">{e.appts}</td>
                  <td className={cn("td text-right tabular-nums font-semibold", (e.rate ?? 0) === 0 ? "text-rose-500" : "text-ink")}>{e.rate == null ? "—" : `${(e.rate * 100).toFixed(1)}%`}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="td text-center text-ink/40 py-6">この期間の展示会リードはありません</td></tr>}
            </tbody>
          </table>
          {selected === "apptRate" && rows.length > 0 && (
            <p className="text-[11px] text-ink/45 mt-2">アポ率の低い順。0%の展示会リストは掘り起こしの最優先対象です。</p>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-ink/45 mb-2">リード獲得の月次推移</div>
          <MonthlyBars series={monthly} pick={(m) => m.leads} format={(v) => v.toLocaleString("ja-JP")} />
        </div>
      </div>
    );
  }

  if (selected === "meetRate" || selected === "winRate") {
    const rows = [...reps].map((r) => ({
      ...r,
      meetRate: r.appts && r.appts > 0 ? (r.meets ?? 0) / r.appts : null,
      winRate: r.meets && r.meets > 0 ? (r.won ?? 0) / r.meets : null,
    }));
    rows.sort((a, b) => (selected === "meetRate" ? (a.meetRate ?? 99) - (b.meetRate ?? 99) : (a.winRate ?? 99) - (b.winRate ?? 99)));
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-black/[0.06]">
            <th className="th">担当</th><th className="th text-right">アポ</th><th className="th text-right">商談実施</th><th className="th text-right">実施率</th>
            <th className="th text-right">受注</th><th className="th text-right">受注率</th><th className="th text-right">売上(コホート)</th>
          </tr></thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <tr key={r.name} className="row-hover">
                <td className="td text-xs font-medium">{r.name}</td>
                <td className="td text-right tabular-nums">{r.appts}</td>
                <td className="td text-right tabular-nums">{r.meets}</td>
                <td className={cn("td text-right tabular-nums", selected === "meetRate" && "font-bold")}>{r.meetRate == null ? "—" : `${(r.meetRate * 100).toFixed(0)}%`}</td>
                <td className="td text-right tabular-nums">{r.won}</td>
                <td className={cn("td text-right tabular-nums", selected === "winRate" && "font-bold")}>{r.winRate == null ? "—" : `${(r.winRate * 100).toFixed(0)}%`}</td>
                <td className="td text-right tabular-nums">{formatYen(Number(r.revenue ?? 0))}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="td text-center text-ink/40 py-6">この期間のデータがありません</td></tr>}
          </tbody>
        </table>
        <p className="text-[11px] text-ink/45 mt-2">
          {selected === "meetRate" ? "実施率の低い順。担当者間のばらつきが大きい場合は日程調整の仕組みを見直してください。" : "受注率の低い順。件数が少ない担当は率がブレるため参考値です。"}
        </p>
      </div>
    );
  }

  if (selected === "avgPrice") {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-black/[0.06]">
              <th className="th">商材</th><th className="th text-right">受注</th><th className="th text-right">売上</th><th className="th text-right">平均単価</th>
            </tr></thead>
            <tbody className="divide-y divide-black/[0.04]">
              {products.map((p) => (
                <tr key={p.name} className="row-hover">
                  <td className="td text-xs font-medium">{p.name}</td>
                  <td className="td text-right tabular-nums">{p.won}</td>
                  <td className="td text-right tabular-nums">{formatYen(Number(p.revenue ?? 0))}</td>
                  <td className="td text-right tabular-nums font-semibold">{p.won && p.won > 0 ? formatYen(Number(p.revenue ?? 0) / p.won) : "—"}</td>
                </tr>
              ))}
              {products.length === 0 && <tr><td colSpan={4} className="td text-center text-ink/40 py-6">この期間の受注はありません</td></tr>}
            </tbody>
          </table>
          <p className="text-[11px] text-ink/45 mt-2">単価改善は「高単価商材の提案比率」と「値引き率」の2軸で確認を。</p>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink/45 mb-2">売上の月次推移(計上)</div>
          <MonthlyBars series={monthly} pick={(m) => m.revenue} format={(v) => formatYen(v)} color="bg-teal-deep" />
        </div>
      </div>
    );
  }

  // デフォルト: 12ヶ月推移(売上・リード)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <div className="text-xs font-semibold text-ink/45 mb-2">売上（計上・月次）</div>
        <MonthlyBars series={monthly} pick={(m) => m.revenue} format={(v) => formatYen(v)} color="bg-teal-deep" />
      </div>
      <div>
        <div className="text-xs font-semibold text-ink/45 mb-2">リード獲得（月次）</div>
        <MonthlyBars series={monthly} pick={(m) => m.leads} format={(v) => v.toLocaleString("ja-JP")} color="bg-violet-400" />
      </div>
    </div>
  );
}
