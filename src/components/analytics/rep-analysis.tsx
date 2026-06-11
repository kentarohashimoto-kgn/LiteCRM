"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { REP_STATUS } from "@/lib/constants";
import { setRepStatusAction } from "@/server/actions";
import { SimpleBar } from "@/components/charts/forecast-chart";
import { RepTrendChart } from "@/components/charts/rep-trend-chart";
import { formatYen, formatPercent, cn } from "@/lib/utils";

export interface RepMonth {
  label: string;
  revenue: number;
  deals: number;
  appts: number;
  target: number;
}
export interface RepRow {
  userId: string;
  name: string;
  status?: string;
  openCount: number;
  openAmount: number;
  wonCount: number;
  wonAmount: number;
  winRate: number;
  avgDealSize: number;
  nextActionRate: number;
  staleCount: number;
  months: RepMonth[];
}

export function RepAnalysis({ rows }: { rows: RepRow[] }) {
  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [openRep, setOpenRep] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (statusSel.length === 0) return rows;
    return rows.filter((r) => statusSel.includes(r.status ?? ""));
  }, [rows, statusSel]);

  function toggleStatus(k: string) {
    setStatusSel((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  return (
    <div className="space-y-5">
      {/* ステータスフィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink/40">ステータス絞り込み:</span>
        {REP_STATUS.map((s) => (
          <button
            key={s.key}
            onClick={() => toggleStatus(s.key)}
            className={cn("pill border transition-colors", statusSel.includes(s.key) ? "bg-teal-primary text-white border-teal-primary" : "bg-white text-ink/60 border-black/10")}
          >
            {s.label}
          </button>
        ))}
        {statusSel.length > 0 && (
          <button onClick={() => setStatusSel([])} className="text-xs text-teal-deep hover:underline">クリア</button>
        )}
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-3">受注金額</h2>
        <SimpleBar data={filtered.map((r) => ({ label: r.name, value: r.wonAmount }))} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">担当営業</th>
              <th className="th">ステータス</th>
              <th className="th text-right">進行中</th>
              <th className="th text-right">進行中金額</th>
              <th className="th text-right">受注数</th>
              <th className="th text-right">受注金額</th>
              <th className="th text-right">受注率</th>
              <th className="th text-right">平均単価</th>
              <th className="th text-right">次AC設定率</th>
              <th className="th text-right">放置案件</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {filtered.map((r) => {
              const isOpen = openRep === r.userId;
              return (
                <RepRowView key={r.userId} r={r} isOpen={isOpen} onToggle={() => setOpenRep(isOpen ? null : r.userId)} />
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={11} className="td text-center text-ink/40 py-10">該当する担当者がいません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RepRowView({ r, isOpen, onToggle }: { r: RepRow; isOpen: boolean; onToggle: () => void }) {
  const totalTarget = r.months.reduce((s, m) => s + m.target, 0);
  const totalRev = r.months.reduce((s, m) => s + m.revenue, 0);
  return (
    <>
      <tr className="row-hover">
        <td className="td font-medium">{r.name}</td>
        <td className="td">
          <form action={setRepStatusAction}>
            <input type="hidden" name="user_id" value={r.userId} />
            <select name="rep_status" defaultValue={r.status ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-teal-primary">
              <option value="">—</option>
              {REP_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </form>
        </td>
        <td className="td text-right tabular-nums">{r.openCount}</td>
        <td className="td text-right tabular-nums">{formatYen(r.openAmount)}</td>
        <td className="td text-right tabular-nums">{r.wonCount}</td>
        <td className="td text-right tabular-nums font-semibold stat-accent">{formatYen(r.wonAmount)}</td>
        <td className="td text-right tabular-nums">{formatPercent(r.winRate)}</td>
        <td className="td text-right tabular-nums">{formatYen(r.avgDealSize)}</td>
        <td className="td text-right tabular-nums"><span className={r.nextActionRate < 0.8 ? "text-accent-orange font-medium" : ""}>{formatPercent(r.nextActionRate)}</span></td>
        <td className="td text-right tabular-nums"><span className={r.staleCount > 0 ? "text-rose-500 font-medium" : "text-ink/50"}>{r.staleCount}</span></td>
        <td className="td text-right">
          <button onClick={onToggle} className="inline-flex items-center gap-0.5 text-xs text-teal-deep hover:underline">
            推移{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={11} className="bg-mist-soft/30 px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">{r.name} の月別推移（直近12ヶ月）</span>
              <span className="text-xs text-ink/50">受注 {formatYen(totalRev)} / 目標 {formatYen(totalTarget)}</span>
            </div>
            <RepTrendChart data={r.months.map((m) => ({ label: m.label, revenue: m.revenue, target: m.target }))} />
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs">
                <thead className="text-ink/40">
                  <tr>
                    <th className="th">月</th>
                    {r.months.map((m) => <th key={m.label} className="th text-right">{m.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <Line label="受注額" cells={r.months.map((m) => formatYen(m.revenue))} accent />
                  <Line label="目標" cells={r.months.map((m) => formatYen(m.target))} />
                  <Line label="受注数" cells={r.months.map((m) => `${m.deals}`)} />
                  <Line label="アポ" cells={r.months.map((m) => `${m.appts}`)} />
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Line({ label, cells, accent }: { label: string; cells: string[]; accent?: boolean }) {
  return (
    <tr className="border-t border-black/[0.04]">
      <td className="td font-medium whitespace-nowrap">{label}</td>
      {cells.map((c, i) => <td key={i} className={cn("td text-right tabular-nums", accent && "stat-accent font-semibold")}>{c}</td>)}
    </tr>
  );
}
