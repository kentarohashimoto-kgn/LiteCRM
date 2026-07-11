"use client";

import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from "recharts";

const TEAL = "#008C8C";
const DEEP = "#006C6A";
const ORANGE = "#F59A2A";
const CURRENT = "#F59A2A";

const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}`;
const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");

export interface DealLite {
  name: string;
  account: string | null;
  amount: number;
  weighted?: number;
  forecast_category?: string;
  yomi?: string | null;
}
type Breakdowns = Record<string, { won: DealLite[]; open: DealLite[] }>;

export interface TrendPoint {
  key: string;
  label: string;
  isCurrent?: boolean;
  leads: number;
  appts: number;
  deals: number;
  revenue: number;
  closeRate: number | null; // 0-100
  tLeads: number;
  tAppts: number;
  tDeals: number;
  tAmount: number;
  wRevenue: number; // weighted 売上見込み
}

type MetricKey = "leads" | "appts" | "deals" | "revenue" | "closeRate";

const METRICS: { key: MetricKey; label: string; unit: "count" | "yen" | "percent" }[] = [
  { key: "leads", label: "新規リード数", unit: "count" },
  { key: "appts", label: "アポ数", unit: "count" },
  { key: "deals", label: "成約数", unit: "count" },
  { key: "revenue", label: "売上額", unit: "yen" },
  { key: "closeRate", label: "成約率(アポ→成約)", unit: "percent" },
];

export function MetricTrendChart({
  data,
  centered,
  breakdowns,
  fyLabel = "年度",
}: {
  data: TrendPoint[];
  centered?: TrendPoint[];
  breakdowns?: Breakdowns;
  fyLabel?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const [win, setWin] = useState<"fy" | "centered">("fy");
  const [sel, setSel] = useState<string | null>(null);
  const cfg = METRICS.find((m) => m.key === metric)!;

  const active = win === "centered" && centered ? centered : data;
  const series = active.map((d) => {
    const actual = metric === "closeRate" ? d.closeRate : (d[metric] as number);
    const plan =
      metric === "leads" ? d.tLeads :
      metric === "appts" ? d.tAppts :
      metric === "deals" ? d.tDeals :
      metric === "revenue" ? d.tAmount :
      d.tAppts > 0 ? Math.round((d.tDeals / d.tAppts) * 100) : 0;
    const forecast = metric === "revenue" ? d.wRevenue : null;
    return { key: d.key, label: d.label, isCurrent: !!d.isCurrent, actual, plan, forecast };
  });

  const planHasData = series.some((s) => (s.plan ?? 0) > 0);
  const forecastHasData = series.some((s) => (s.forecast ?? 0) > 0);
  const showBreakdown = metric === "revenue" && !!breakdowns;

  const fmtAxis = (v: number) => (cfg.unit === "yen" ? man(v) + "万" : cfg.unit === "percent" ? v + "%" : `${v}`);
  const fmtTip = (v: number) => (cfg.unit === "yen" ? yen(v) : cfg.unit === "percent" ? `${v}%` : `${v}件`);

  const selBd = sel && breakdowns ? breakdowns[sel] : null;
  const selLabel = sel ? active.find((d) => d.key === sel)?.label : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${metric === m.key ? "bg-teal-primary text-white" : "bg-mist-soft text-ink/60 hover:text-ink"}`}
          >
            {m.label}
          </button>
        ))}
        {centered && (
          <div className="ml-auto inline-flex items-center gap-0.5 rounded-lg bg-mist-soft p-0.5">
            <button
              onClick={() => setWin("fy")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${win === "fy" ? "bg-white text-teal-deep shadow-sm" : "text-ink/50"}`}
            >
              {fyLabel}
            </button>
            <button
              onClick={() => setWin("centered")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${win === "centered" ? "bg-white text-teal-deep shadow-sm" : "text-ink/50"}`}
            >
              前後6ヶ月
            </button>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} onClick={(e) => {
          const k = (e && (e as { activePayload?: { payload?: { key?: string } }[] }).activePayload?.[0]?.payload?.key) || null;
          if (showBreakdown && k) setSel((prev) => (prev === k ? null : k));
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={52} />
          <Tooltip content={<TrendTip cfg={cfg} fmtTip={fmtTip} breakdowns={showBreakdown ? breakdowns : undefined} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {win === "centered" && series.some((s) => s.isCurrent) && (
            <ReferenceLine x={series.find((s) => s.isCurrent)?.label} stroke={CURRENT} strokeDasharray="3 3" label={{ value: "当月", position: "top", fontSize: 10, fill: CURRENT }} />
          )}
          {cfg.unit === "percent" ? (
            <Line dataKey="actual" name="実績" stroke={TEAL} strokeWidth={2.5} dot={{ r: 3, fill: TEAL }} connectNulls />
          ) : (
            <Bar dataKey="actual" name="実績" radius={[4, 4, 0, 0]} maxBarSize={36} cursor={showBreakdown ? "pointer" : undefined}>
              {series.map((s) => (
                <Cell key={s.key} fill={s.key === sel ? DEEP : TEAL} />
              ))}
            </Bar>
          )}
          {forecastHasData && <Line dataKey="forecast" name="見込み(予測)" stroke={DEEP} strokeWidth={2} strokeDasharray="4 3" dot={false} />}
          {planHasData && <Line dataKey="plan" name="目標" stroke={ORANGE} strokeWidth={2} dot={{ r: 2.5, fill: ORANGE }} />}
        </ComposedChart>
      </ResponsiveContainer>

      {showBreakdown && (
        selBd ? (
          <BreakdownPanel label={selLabel ?? ""} won={selBd.won} open={selBd.open} onClose={() => setSel(null)} />
        ) : (
          <p className="mt-1 text-center text-[11px] text-ink/35">棒グラフをクリックすると、その月の売上・見込みの内訳（案件一覧）を表示します</p>
        )
      )}
    </div>
  );
}

/* ツールチップ: 値＋（売上のとき）内訳トップを表示 */
function TrendTip({ active, payload, cfg, fmtTip, breakdowns }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; payload: { key: string; label: string } }[];
  cfg: { unit: string };
  fmtTip: (v: number) => string;
  breakdowns?: Breakdowns;
}) {
  if (!active || !payload?.length) return null;
  const p0 = payload[0].payload;
  const bd = breakdowns?.[p0.key];
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-2 shadow-md text-xs min-w-[160px]">
      <div className="font-bold text-ink mb-1">{p0.label}</div>
      {payload.map((s) => (
        <div key={s.name} className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1 text-ink/60"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
          <span className="tabular-nums font-medium text-ink">{fmtTip(s.value)}</span>
        </div>
      ))}
      {bd && cfg.unit === "yen" && (bd.won.length > 0 || bd.open.length > 0) && (
        <div className="mt-1.5 border-t border-black/[0.06] pt-1.5 space-y-0.5">
          {bd.won.slice(0, 3).map((d, i) => (
            <div key={"w" + i} className="flex justify-between gap-3 text-[11px]">
              <span className="truncate max-w-[150px] text-teal-deep">✓ {d.account ?? d.name}</span>
              <span className="tabular-nums text-ink/60">{yen(d.amount)}</span>
            </div>
          ))}
          {bd.open.slice(0, 3).map((d, i) => (
            <div key={"o" + i} className="flex justify-between gap-3 text-[11px]">
              <span className="truncate max-w-[150px] text-ink/45">◦ {d.account ?? d.name}</span>
              <span className="tabular-nums text-ink/45">{yen(d.amount)}</span>
            </div>
          ))}
          <div className="text-[10px] text-ink/35 pt-0.5">クリックで全内訳</div>
        </div>
      )}
    </div>
  );
}

export function BreakdownPanel({ label, won, open, onClose }: { label: string; won: DealLite[]; open: DealLite[]; onClose: () => void }) {
  const wonSum = won.reduce((s, d) => s + d.amount, 0);
  const openSum = open.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="mt-3 rounded-xl border border-black/[0.06] bg-mist-soft/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-ink">{label} の内訳</span>
        <button onClick={onClose} className="text-[11px] text-ink/40 hover:text-ink/70">閉じる ✕</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DealCol title="受注（実績）" tone="teal" deals={won} total={wonSum} />
        <DealCol title="進行中（見込み）" tone="gray" deals={open} total={openSum} />
      </div>
    </div>
  );
}

function DealCol({ title, tone, deals, total }: { title: string; tone: "teal" | "gray"; deals: DealLite[]; total: number }) {
  return (
    <div className="rounded-lg bg-white border border-black/[0.05] p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-bold ${tone === "teal" ? "text-teal-deep" : "text-ink/60"}`}>{title}</span>
        <span className="text-xs tabular-nums font-semibold text-ink/70">{yen(total)}</span>
      </div>
      {deals.length === 0 ? (
        <p className="text-[11px] text-ink/35 py-1">なし</p>
      ) : (
        <ul className="space-y-1">
          {deals.map((d, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="min-w-0 truncate text-ink/80" title={d.name}>
                {d.account ?? "—"}
                {d.yomi && <span className="ml-1 text-ink/35">{d.yomi}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-ink/60">{yen(d.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
