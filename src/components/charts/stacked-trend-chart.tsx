"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface StackSeries {
  key: string;
  name: string;
  color: string;
}

export type StackUnit = "count" | "yen";
export type StackMode = "value" | "share";

interface TooltipPayloadItem {
  dataKey: string;
  name: string;
  value: number;
  color?: string;
  fill?: string;
}

const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");
const fmtVal = (v: number, unit: StackUnit) => (unit === "yen" ? yen(v) : `${v}件`);

function makeTooltip(unit: StackUnit, mode: StackMode) {
  return function StackTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
    if (!active || !payload || payload.length === 0) return null;
    const items = payload.filter((p) => (p.value ?? 0) > 0).sort((a, b) => b.value - a.value);
    if (items.length === 0) return null;
    const total = payload.reduce((s, p) => s + (p.value || 0), 0);
    return (
      <div className="rounded-lg bg-white shadow-lg border border-black/10 p-2 text-xs max-w-[240px]">
        <div className="font-semibold text-ink mb-1">{label}・計 {fmtVal(total, unit)}</div>
        {items.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
            <span className="text-ink/70 truncate">{p.name}</span>
            <span className="ml-auto tabular-nums">
              {mode === "share" ? `${total ? Math.round((p.value / total) * 100) : 0}%` : fmtVal(p.value, unit)}
              {mode === "share" && <span className="text-ink/35"> ({fmtVal(p.value, unit)})</span>}
            </span>
          </div>
        ))}
      </div>
    );
  };
}

/** 月別の積み上げ棒グラフ。mode="share"で100%積み上げ(構成比)。 */
export function StackedTrendChart({
  data,
  series,
  unit = "count",
  mode = "value",
}: {
  data: Record<string, string | number>[];
  series: StackSeries[];
  unit?: StackUnit;
  mode?: StackMode;
}) {
  const yTick = (v: number) =>
    mode === "share" ? `${Math.round(v * 100)}%` : unit === "yen" ? `${Math.round(v / 10000).toLocaleString("ja-JP")}万` : `${v}`;
  const Tip = makeTooltip(unit, mode);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} stackOffset={mode === "share" ? "expand" : "none"}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yTick} tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={unit === "yen" || mode === "share" ? 48 : 32} allowDecimals={false} />
        <Tooltip content={<Tip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} maxBarSize={42} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
