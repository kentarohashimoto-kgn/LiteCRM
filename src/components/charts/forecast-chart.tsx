"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DealLite } from "./trend-chart";

const TEAL = "#008C8C";
const DEEP = "#006C6A";
const LIGHT = "#9ED7D3";
const ORANGE = "#F59A2A";

const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");
const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}`;

export interface ForecastChartDatum {
  key?: string;
  label: string;
  commit: number;
  bestCase: number;
  pipeline: number;
  weighted: number;
  target: number;
}

export function ForecastChart({ data, breakdowns }: { data: ForecastChartDatum[]; breakdowns?: Record<string, DealLite[]> }) {
  const [sel, setSel] = useState<string | null>(null);
  const canDrill = !!breakdowns;
  const selDeals = sel && breakdowns ? breakdowns[sel] ?? [] : null;
  const selLabel = sel ? data.find((d) => d.key === sel)?.label : null;

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} onClick={(e) => {
          const k = (e && (e as { activePayload?: { payload?: { key?: string } }[] }).activePayload?.[0]?.payload?.key) || null;
          if (canDrill && k) setSel((p) => (p === k ? null : k));
        }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => man(v) + "万"} tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<FcTip breakdowns={breakdowns} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="commit" name="Commit" stackId="a" fill={TEAL} maxBarSize={42} cursor={canDrill ? "pointer" : undefined}>
            {data.map((d) => <Cell key={d.key ?? d.label} fill={d.key === sel ? DEEP : TEAL} />)}
          </Bar>
          <Bar dataKey="bestCase" name="Best Case" stackId="a" fill={LIGHT} radius={[4, 4, 0, 0]} maxBarSize={42} cursor={canDrill ? "pointer" : undefined} />
          <Line dataKey="target" name="目標" stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3, fill: ORANGE }} />
          <Line dataKey="weighted" name="Weighted" stroke={DEEP} strokeWidth={2} strokeDasharray="4 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>

      {canDrill && (
        selDeals ? (
          <ForecastBreakdown label={selLabel ?? ""} deals={selDeals} onClose={() => setSel(null)} />
        ) : (
          <p className="mt-1 text-center text-[11px] text-ink/35">棒グラフをクリックすると、その月の予測を構成する案件の内訳を表示します</p>
        )
      )}
    </div>
  );
}

function FcTip({ active, payload, breakdowns }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; payload: { key?: string; label: string } }[];
  breakdowns?: Record<string, DealLite[]>;
}) {
  if (!active || !payload?.length) return null;
  const p0 = payload[0].payload;
  const deals = p0.key && breakdowns ? breakdowns[p0.key] ?? [] : [];
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-2 shadow-md text-xs min-w-[170px]">
      <div className="font-bold text-ink mb-1">{p0.label}</div>
      {payload.map((s) => (
        <div key={s.name} className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1 text-ink/60"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
          <span className="tabular-nums font-medium text-ink">{yen(s.value)}</span>
        </div>
      ))}
      {deals.length > 0 && (
        <div className="mt-1.5 border-t border-black/[0.06] pt-1.5 space-y-0.5">
          {deals.slice(0, 3).map((d, i) => (
            <div key={i} className="flex justify-between gap-3 text-[11px]">
              <span className="truncate max-w-[150px] text-ink/55">◦ {d.account ?? d.name}{d.yomi ? ` ${d.yomi}` : ""}</span>
              <span className="tabular-nums text-ink/45">{yen(d.amount)}</span>
            </div>
          ))}
          <div className="text-[10px] text-ink/35 pt-0.5">クリックで全内訳</div>
        </div>
      )}
    </div>
  );
}

function ForecastBreakdown({ label, deals, onClose }: { label: string; deals: DealLite[]; onClose: () => void }) {
  const commit = deals.filter((d) => d.forecast_category === "commit");
  const best = deals.filter((d) => d.forecast_category === "best_case");
  const pipe = deals.filter((d) => d.forecast_category !== "commit" && d.forecast_category !== "best_case");
  const sum = (a: DealLite[]) => a.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="mt-3 rounded-xl border border-black/[0.06] bg-mist-soft/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-ink">{label} の予測内訳</span>
        <button onClick={onClose} className="text-[11px] text-ink/40 hover:text-ink/70">閉じる ✕</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Col title="Commit(受注確実)" deals={commit} total={sum(commit)} />
        <Col title="Best Case" deals={best} total={sum(best)} />
        <Col title="Pipeline" deals={pipe} total={sum(pipe)} />
      </div>
    </div>
  );
}

function Col({ title, deals, total }: { title: string; deals: DealLite[]; total: number }) {
  return (
    <div className="rounded-lg bg-white border border-black/[0.05] p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-ink/70">{title}</span>
        <span className="text-xs tabular-nums font-semibold text-ink/70">{yen(total)}</span>
      </div>
      {deals.length === 0 ? (
        <p className="text-[11px] text-ink/35 py-1">なし</p>
      ) : (
        <ul className="space-y-1">
          {deals.map((d, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="min-w-0 truncate text-ink/80" title={d.name}>{d.account ?? "—"}{d.yomi && <span className="ml-1 text-ink/35">{d.yomi}</span>}</span>
              <span className="shrink-0 tabular-nums text-ink/60">{yen(d.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SimpleBar({
  data,
  color = TEAL,
}: {
  data: { label: string; value: number }[];
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => man(v) + "万"} tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 12, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v: number) => yen(v)} contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={26}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
