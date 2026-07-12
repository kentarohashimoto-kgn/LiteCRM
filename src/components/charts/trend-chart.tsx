"use client";

// recharts を遅延ロードするラッパー(型は再エクスポート)。実装は ./trend-chart.impl。
import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { DealLite, TrendPoint } from "./trend-chart.impl";

export const MetricTrendChart = dynamic(
  () => import("./trend-chart.impl").then((m) => m.MetricTrendChart),
  { ssr: false, loading: () => <ChartFallback h={300} /> },
);

export const BreakdownPanel = dynamic(
  () => import("./trend-chart.impl").then((m) => m.BreakdownPanel),
  { ssr: false, loading: () => <ChartFallback h={120} /> },
);
