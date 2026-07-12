"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TEAL = "#008C8C";
const LIGHT = "#9ED7D3";

export interface TrendDatum {
  label: string;
  count: number;
  isFuture?: boolean;
}

/** 月別の案件数推移(実績=ティール / 予定=ライト) */
export function AppointmentTrendChart({ data }: { data: TrendDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
        <Tooltip
          formatter={(v: number) => [v + "件", "案件数"]}
          contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.isFuture ? LIGHT : TEAL} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
