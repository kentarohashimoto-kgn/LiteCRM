"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { TrendDatum } from "./appointment-trend-chart.impl";

export const AppointmentTrendChart = dynamic(
  () => import("./appointment-trend-chart.impl").then((m) => m.AppointmentTrendChart),
  { ssr: false, loading: () => <ChartFallback h={220} /> },
);
