"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { RepSummaryChart } from "@/components/charts/rep-summary-chart";
import type { TrendPoint } from "@/lib/data/rep-report";

/** 週次/月次の 目標 vs 実績 推移。上部サマリーグラフ(週別・月別切替)。 */
export function RepTrendSummary({ monthly, weekly }: { monthly: TrendPoint[]; weekly: TrendPoint[] }) {
  const [mode, setMode] = useState<"weekly" | "monthly">("weekly");
  const data = mode === "weekly" ? weekly : monthly;

  return (
    <section className="card">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/[0.04]">
        <h2 className="section-title">
          <TrendingUp size={15} className="text-teal-primary" />
          目標 vs 実績の推移
        </h2>
        <div className="flex gap-1 text-xs">
          {(["weekly", "monthly"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                mode === m ? "bg-teal-primary text-white" : "bg-mist-soft text-ink/60 hover:bg-teal-light",
              )}
            >
              {m === "weekly" ? "週別" : "月別"}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5 pt-4">
        <RepSummaryChart data={data} />
      </div>
    </section>
  );
}
