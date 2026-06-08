"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface StackSeries {
  key: string;
  name: string;
  color: string;
}

interface TooltipPayloadItem {
  dataKey: string;
  name: string;
  value: number;
  color?: string;
  fill?: string;
}

function StackTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const items = payload.filter((p) => (p.value ?? 0) > 0).sort((a, b) => b.value - a.value);
  if (items.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg bg-white shadow-lg border border-black/10 p-2 text-xs max-w-[220px]">
      <div className="font-semibold text-ink mb-1">{label}・計 {total}件</div>
      {items.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-ink/70 truncate">{p.name}</span>
          <span className="ml-auto tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** 月別の積み上げ棒グラフ(担当者別・展示会別 等)。 */
export function StackedTrendChart({
  data,
  series,
}: {
  data: Record<string, string | number>[];
  series: StackSeries[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
        <Tooltip content={<StackTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} maxBarSize={42} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
