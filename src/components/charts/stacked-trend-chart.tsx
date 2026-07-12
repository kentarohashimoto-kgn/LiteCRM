"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { StackSeries, StackUnit, StackMode } from "./stacked-trend-chart.impl";

export const StackedTrendChart = dynamic(
  () => import("./stacked-trend-chart.impl").then((m) => m.StackedTrendChart),
  { ssr: false, loading: () => <ChartFallback h={280} /> },
);
