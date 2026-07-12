"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "@/components/charts/_fallback";

export type { WeeklyPoint, AssigneePoint } from "./report-charts.impl";

export const WeeklyChart = dynamic(
  () => import("./report-charts.impl").then((m) => m.WeeklyChart),
  { ssr: false, loading: () => <ChartFallback h={260} /> },
);

export const AssigneeChart = dynamic(
  () => import("./report-charts.impl").then((m) => m.AssigneeChart),
  { ssr: false, loading: () => <ChartFallback h={260} /> },
);
