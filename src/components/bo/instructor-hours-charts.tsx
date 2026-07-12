"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "@/components/charts/_fallback";

export type { BarDatum, HoursSeries } from "./instructor-hours-charts.impl";

export const InstructorHoursBar = dynamic(
  () => import("./instructor-hours-charts.impl").then((m) => m.InstructorHoursBar),
  { ssr: false, loading: () => <ChartFallback h={260} /> },
);

export const InstructorHoursTrend = dynamic(
  () => import("./instructor-hours-charts.impl").then((m) => m.InstructorHoursTrend),
  { ssr: false, loading: () => <ChartFallback h={260} /> },
);
