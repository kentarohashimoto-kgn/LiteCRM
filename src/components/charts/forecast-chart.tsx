"use client";

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

const TEAL = "#008C8C";
const DEEP = "#006C6A";
const LIGHT = "#9ED7D3";
const ORANGE = "#F59A2A";

const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");
const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}`;

export interface ForecastChartDatum {
  label: string;
  commit: number;
  bestCase: number;
  pipeline: number;
  weighted: number;
  target: number;
}

export function ForecastChart({ data }: { data: ForecastChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(v) => man(v) + "万"}
          tick={{ fontSize: 11, fill: "#9aa6a6" }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          formatter={(v: number, name) => [yen(v), name]}
          contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="commit" name="Commit" stackId="a" fill={TEAL} radius={[0, 0, 0, 0]} maxBarSize={42} />
        <Bar dataKey="bestCase" name="Best Case" stackId="a" fill={LIGHT} radius={[4, 4, 0, 0]} maxBarSize={42} />
        <Line dataKey="target" name="目標" stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3, fill: ORANGE }} />
        <Line dataKey="weighted" name="Weighted" stroke={DEEP} strokeWidth={2} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
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
