"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TEAL = "#008C8C";
const ORANGE = "#F59A2A";
const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}`;

export interface RepTrendDatum {
  label: string;
  revenue: number;
  target: number;
}

/** 営業マンの月別: 受注額(棒) と 目標(折れ線) */
export function RepTrendChart({ data }: { data: RepTrendDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => man(v) + "万"} tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={52} />
        <Tooltip
          formatter={(v: number, n) => ["¥" + Math.round(v).toLocaleString("ja-JP"), n === "受注額" ? "受注額" : "目標"]}
          contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }}
        />
        <Bar dataKey="revenue" name="受注額" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={34} />
        <Line dataKey="target" name="目標" stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3, fill: ORANGE }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
