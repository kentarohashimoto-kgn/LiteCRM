"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";

export interface BarDatum { name: string; hours: number; color: string }
export interface HoursSeries { key: string; name: string; color: string }

const h = (v: number) => `${Number(v).toLocaleString("ja-JP")}h`;

/** 選択月の講師別 稼働時間(棒)。担当者間のばらつきを見る。 */
export function InstructorHoursBar({ data, monthLabel }: { data: BarDatum[]; monthLabel: string }) {
  if (data.length === 0) {
    return <p className="text-sm text-ink/40 py-8 text-center">{monthLabel}は時刻入りの研修がありません（稼働時間は開始・終了時刻から算出します）</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 44 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}h`} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#5b6b6b" }} axisLine={false} tickLine={false} width={72} />
        <Tooltip formatter={(v: number) => [h(v), "稼働時間"]} contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
        <Bar dataKey="hours" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface TipItem { dataKey: string; name: string; value: number; color?: string }
function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: TipItem[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const items = payload.filter((p) => (p.value ?? 0) > 0).sort((a, b) => b.value - a.value);
  if (items.length === 0) return <div className="rounded-lg bg-white shadow-lg border border-black/10 p-2 text-xs"><div className="font-semibold">{label}</div><div className="text-ink/45">稼働なし</div></div>;
  return (
    <div className="rounded-lg bg-white shadow-lg border border-black/10 p-2 text-xs max-w-[220px]">
      <div className="font-semibold text-ink mb-1">{label}</div>
      {items.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-ink/70 truncate">{p.name}</span>
          <span className="ml-auto tabular-nums">{h(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** 複数月の講師別 稼働時間 推移(折れ線)。増減トレンドと差配を見る。 */
export function InstructorHoursTrend({ data, series }: { data: Record<string, string | number>[]; series: HoursSeries[] }) {
  if (series.length === 0) {
    return <p className="text-sm text-ink/40 py-8 text-center">対象期間に時刻入りの研修がありません</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}h`} allowDecimals={false} />
        <Tooltip content={<TrendTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
