"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { RepTrendDatum } from "./rep-summary-chart.impl";

export const RepSummaryChart = dynamic(
  () => import("./rep-summary-chart.impl").then((m) => m.RepSummaryChart),
  { ssr: false, loading: () => <ChartFallback h={240} /> },
);
