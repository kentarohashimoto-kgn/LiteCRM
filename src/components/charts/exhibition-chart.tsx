"use client";

import dynamic from "next/dynamic";
import { ChartFallback } from "./_fallback";

export type { ExhibitionDatum } from "./exhibition-chart.impl";

export const ExhibitionChart = dynamic(
  () => import("./exhibition-chart.impl").then((m) => m.ExhibitionChart),
  { ssr: false, loading: () => <ChartFallback h={300} /> },
);
