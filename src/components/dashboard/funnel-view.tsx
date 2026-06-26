"use client";

import { useState } from "react";

export interface FunnelScope {
  leads: number;
  appts: number;
  deals: number;
}

export interface FunnelData {
  total: FunnelScope;
  lastMonth: FunnelScope;
  thisMonth: FunnelScope;
}

const STAGES: { key: keyof FunnelScope; label: string; color: string; width: string }[] = [
  { key: "leads", label: "リード", color: "bg-teal-primary", width: "w-full" },
  { key: "appts", label: "アポ", color: "bg-teal-deep", width: "w-3/4" },
  { key: "deals", label: "成約", color: "bg-accent-orange", width: "w-1/2" },
];

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

export function FunnelView({ data, totalLabel = "累計" }: { data: FunnelData; totalLabel?: string }) {
  const [scope, setScope] = useState<keyof FunnelData>("total");
  const s = data[scope];
  const SCOPES: { key: keyof FunnelData; label: string }[] = [
    { key: "total", label: totalLabel },
    { key: "lastMonth", label: "先月" },
    { key: "thisMonth", label: "今月" },
  ];

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
        {SCOPES.map((sc) => (
          <button
            key={sc.key}
            onClick={() => setScope(sc.key)}
            className={`rounded-lg px-3 py-1.5 font-medium ${scope === sc.key ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink"}`}
          >
            {sc.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {STAGES.map((st, i) => {
          const value = s[st.key];
          const prev = i > 0 ? s[STAGES[i - 1].key] : null;
          return (
            <div key={st.key} className="flex items-center gap-3">
              <div className={`${st.width} min-w-0`}>
                <div className={`${st.color} rounded-lg px-4 py-3 text-white flex items-baseline justify-between shadow-sm`}>
                  <span className="text-sm font-medium">{st.label}</span>
                  <span className="text-2xl font-bold tabular-nums">{value.toLocaleString("ja-JP")}</span>
                </div>
              </div>
              {prev != null && (
                <span className="text-xs text-ink/50 whitespace-nowrap">
                  転換率 <b className="text-ink/80">{pct(value, prev)}</b>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-mist-soft/60 px-3 py-2">
          <span className="text-ink/50">リード→アポ</span>
          <div className="text-base font-bold stat-accent">{pct(s.appts, s.leads)}</div>
        </div>
        <div className="rounded-lg bg-mist-soft/60 px-3 py-2">
          <span className="text-ink/50">アポ→成約</span>
          <div className="text-base font-bold stat-accent">{pct(s.deals, s.appts)}</div>
        </div>
      </div>
    </div>
  );
}
