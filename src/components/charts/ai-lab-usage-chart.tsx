"use client";

// recharts を遅延ロードするラッパー(型は再エクスポート)。実装は ./ai-lab-usage-chart.impl。
import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { UsageTrendPoint } from "./ai-lab-usage-chart.impl";

export const AiLabUsageTrendChart = dynamic(
  () => import("./ai-lab-usage-chart.impl").then((m) => m.AiLabUsageTrendChart),
  { ssr: false, loading: () => <ChartFallback h={280} /> },
);
