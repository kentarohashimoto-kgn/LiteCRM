"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { ForecastChartDatum } from "./forecast-chart.impl";

export const ForecastChart = dynamic(
  () => import("./forecast-chart.impl").then((m) => m.ForecastChart),
  { ssr: false, loading: () => <ChartFallback h={320} /> },
);

export const SimpleBar = dynamic(
  () => import("./forecast-chart.impl").then((m) => m.SimpleBar),
  { ssr: false, loading: () => <ChartFallback h={200} /> },
);
