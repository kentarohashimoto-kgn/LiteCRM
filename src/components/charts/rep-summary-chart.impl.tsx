"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TEAL = "#008C8C";
const ORANGE = "#F59A2A";

export interface RepTrendDatum {
  label: string;
  target: number;
  actual: number;
}

const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}`;
const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");

/** 目標(線) vs 実績(棒) の推移。週別/月別いずれのデータでも描画。 */
export function RepSummaryChart({ data }: { data: RepTrendDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => man(v) + "万"} tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={52} />
        <Tooltip formatter={(v: number, n) => [yen(v), n === "actual" ? "実績" : "目標"]} contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="actual" name="実績(受注)" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={40} />
        <Line dataKey="target" name="目標" stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3, fill: ORANGE }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
