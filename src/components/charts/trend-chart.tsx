"use client";

import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

const TEAL = "#008C8C";
const DEEP = "#006C6A";
const ORANGE = "#F59A2A";

const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}`;
const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");

export interface TrendPoint {
  label: string;
  leads: number;
  appts: number;
  deals: number;
  revenue: number;
  closeRate: number | null; // 0-100
  tLeads: number;
  tAppts: number;
  tDeals: number;
  tAmount: number;
  wRevenue: number; // weighted 売上見込み
}

type MetricKey = "leads" | "appts" | "deals" | "revenue" | "closeRate";

const METRICS: { key: MetricKey; label: string; unit: "count" | "yen" | "percent" }[] = [
  { key: "leads", label: "新規リード数", unit: "count" },
  { key: "appts", label: "アポ数", unit: "count" },
  { key: "deals", label: "成約数", unit: "count" },
  { key: "revenue", label: "売上額", unit: "yen" },
  { key: "closeRate", label: "成約率(アポ→成約)", unit: "percent" },
];

export function MetricTrendChart({ data }: { data: TrendPoint[] }) {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const cfg = METRICS.find((m) => m.key === metric)!;

  const series = data.map((d) => {
    const actual = metric === "closeRate" ? d.closeRate : (d[metric] as number);
    const plan =
      metric === "leads" ? d.tLeads :
      metric === "appts" ? d.tAppts :
      metric === "deals" ? d.tDeals :
      metric === "revenue" ? d.tAmount :
      d.tAppts > 0 ? Math.round((d.tDeals / d.tAppts) * 100) : 0;
    const forecast = metric === "revenue" ? d.wRevenue : null;
    return { label: d.label, actual, plan, forecast };
  });

  const planHasData = series.some((s) => (s.plan ?? 0) > 0);
  const forecastHasData = series.some((s) => (s.forecast ?? 0) > 0);

  const fmtAxis = (v: number) => (cfg.unit === "yen" ? man(v) + "万" : cfg.unit === "percent" ? v + "%" : `${v}`);
  const fmtTip = (v: number) => (cfg.unit === "yen" ? yen(v) : cfg.unit === "percent" ? `${v}%` : `${v}件`);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${metric === m.key ? "bg-teal-primary text-white" : "bg-mist-soft text-ink/60 hover:text-ink"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f1" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5b6b6b" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9aa6a6" }} axisLine={false} tickLine={false} width={52} />
          <Tooltip formatter={(v: number, name) => [fmtTip(v), name]} contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {cfg.unit === "percent" ? (
            <Line dataKey="actual" name="実績" stroke={TEAL} strokeWidth={2.5} dot={{ r: 3, fill: TEAL }} connectNulls />
          ) : (
            <Bar dataKey="actual" name="実績" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={36} />
          )}
          {forecastHasData && <Line dataKey="forecast" name="見込み(予測)" stroke={DEEP} strokeWidth={2} strokeDasharray="4 3" dot={false} />}
          {planHasData && <Line dataKey="plan" name="目標" stroke={ORANGE} strokeWidth={2} dot={{ r: 2.5, fill: ORANGE }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
