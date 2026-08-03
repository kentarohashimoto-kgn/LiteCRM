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
const DEEP = "#006C6A";
const ORANGE = "#F59A2A";

export interface UsageTrendPoint {
  month: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  usd: number;
}

const compactTokens = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
};

/**
 * 会社の月別利用推移。
 * 左軸=トークン(入力/出力の積み上げ)、右軸=概算コスト。
 * 「使った量」と「かかった金額」は桁が違うので、同じ軸に載せない。
 */
export function AiLabUsageTrendChart({ data }: { data: UsageTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#0d28281a" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="tokens"
          tickFormatter={compactTokens}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="usd"
          orientation="right"
          tickFormatter={(v: number) => `$${v}`}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          formatter={(value: number, name: string) =>
            name === "概算コスト"
              ? [`$${Number(value).toFixed(2)}`, name]
              : [Number(value).toLocaleString("ja-JP"), name]
          }
          contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid rgba(0,0,0,0.08)" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="tokens" dataKey="inputTokens" name="入力トークン" stackId="t" fill={TEAL} radius={[0, 0, 0, 0]} />
        <Bar yAxisId="tokens" dataKey="outputTokens" name="出力トークン" stackId="t" fill={DEEP} radius={[4, 4, 0, 0]} />
        <Line yAxisId="usd" type="monotone" dataKey="usd" name="概算コスト" stroke={ORANGE} strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
