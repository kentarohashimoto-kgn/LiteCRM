"use client";

import { useMemo, useState } from "react";
import { StackedTrendChart, type StackSeries } from "@/components/charts/stacked-trend-chart";
import { currentFiscalStartYear, fiscalMonths, fiscalYearLabel } from "@/lib/fiscal";
import { monthKey, startOfMonth, addMonths, cn } from "@/lib/utils";

export interface TrendPoint {
  s: string; // seriesKey
  m: string; // monthKey
  v: number;
}

/** 流入元別・商品別 等の月別推移(実数/シェア・指標切替・期間切替)。 */
export function ShareTrend({
  title,
  series,
  countPoints,
  revPoints,
}: {
  title: string;
  series: StackSeries[];
  countPoints: TrendPoint[];
  revPoints: TrendPoint[];
}) {
  const [metric, setMetric] = useState<"count" | "revenue">("count");
  const [mode, setMode] = useState<"value" | "share">("value");
  const [range, setRange] = useState<string>("rolling");
  const now = new Date();
  const cur = currentFiscalStartYear(now);

  const cols = useMemo(() => {
    if (range !== "rolling") {
      return fiscalMonths(parseInt(range, 10)).map((m) => ({ key: m.key, label: `${m.month}月` }));
    }
    return Array.from({ length: 12 }, (_, i) => {
      const d = addMonths(startOfMonth(now), i - 11);
      return { key: monthKey(d), label: `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}` };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const data = useMemo(() => {
    const points = metric === "count" ? countPoints : revPoints;
    const idx = new Map(cols.map((c, i) => [c.key, i]));
    const rows: Record<string, string | number>[] = cols.map((c) => {
      const row: Record<string, string | number> = { label: c.label };
      for (const s of series) row[s.key] = 0;
      return row;
    });
    for (const p of points) {
      const i = idx.get(p.m);
      if (i == null || !(p.s in rows[i])) continue;
      rows[i][p.s] = (rows[i][p.s] as number) + p.v;
    }
    return rows;
  }, [metric, cols, series, countPoints, revPoints]);

  return (
    <div className="card">
      <div className="px-5 pt-4 pb-3 border-b border-black/[0.04] flex items-center justify-between gap-2 flex-wrap">
        <h2 className="section-title">{title}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5 text-xs">
            <Tab active={metric === "count"} onClick={() => setMetric("count")} label="案件数" />
            <Tab active={metric === "revenue"} onClick={() => setMetric("revenue")} label="受注額" />
          </div>
          <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5 text-xs">
            <Tab active={mode === "value"} onClick={() => setMode("value")} label="実数" />
            <Tab active={mode === "share"} onClick={() => setMode("share")} label="シェア" />
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-teal-primary">
            <option value="rolling">直近12ヶ月</option>
            <option value={String(cur - 1)}>{fiscalYearLabel(cur - 1)}</option>
            <option value={String(cur)}>{fiscalYearLabel(cur)}</option>
            <option value={String(cur + 1)}>{fiscalYearLabel(cur + 1)}</option>
          </select>
        </div>
      </div>
      <div className="p-5 pt-4">
        <StackedTrendChart data={data} series={series} unit={metric === "revenue" ? "yen" : "count"} mode={mode} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-[11px] text-ink/70">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-ink/40 mt-2">
          {metric === "count" ? "案件数は作成日ベース。" : "受注額は受注日ベース（受注済み）。"}
          {mode === "share" && " シェアは各月の構成比(100%積み上げ)。"}
        </p>
      </div>
    </div>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cn("rounded-md px-2.5 py-1 font-medium transition-colors", active ? "bg-teal-primary text-white" : "text-ink/55 hover:text-ink")}>
      {label}
    </button>
  );
}
