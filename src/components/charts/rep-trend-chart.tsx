"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { RepTrendDatum } from "./rep-trend-chart.impl";

export const RepTrendChart = dynamic(
  () => import("./rep-trend-chart.impl").then((m) => m.RepTrendChart),
  { ssr: false, loading: () => <ChartFallback h={200} /> },
);
