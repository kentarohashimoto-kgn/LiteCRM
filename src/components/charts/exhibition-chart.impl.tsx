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

const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}`;

export interface ExhibitionDatum {
  label: string;
  revenue: number; // 売上(CRM)
  leads: number; // リード数
}

/** 展示会別: 売上(棒/左軸) と リード数(折れ線/右軸) */
export function ExhibitionChart({ data }: { data: ExhibitionDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#5b6b6b" }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={70}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={(v) => man(v) + "万"}
          tick={{ fontSize: 11, fill: "#9aa6a6" }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: "#c79153" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          formatter={(v: number, name) =>
            name === "売上(CRM)" ? ["¥" + Math.round(v).toLocaleString("ja-JP"), name] : [v + "件", name]
          }
          contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="left" dataKey="revenue" name="売上(CRM)" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={34} />
        <Line yAxisId="right" dataKey="leads" name="リード数" stroke={ORANGE} strokeWidth={2.5} dot={{ r: 3, fill: ORANGE }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
