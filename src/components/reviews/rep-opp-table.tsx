"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { formatYen, formatDate, cn } from "@/lib/utils";
import { saveRepForecastAction } from "@/server/actions/rep-report";
import type { RepReportOpp } from "@/lib/data/rep-report";

type SortKey = "yomi" | "amount" | "lastActivity" | "risk";

const yomiRank = (y: string | null) => {
  const n = y ? parseInt(y.charAt(0), 10) : NaN;
  return Number.isNaN(n) ? 99 : n;
};
const riskRank = (r: string | null) => (r === "high" ? 0 : r === "middle" ? 1 : r === "low" ? 2 : 3);
const RISK_META: Record<string, { label: string; cls: string }> = {
  high: { label: "高", cls: "bg-rose-100 text-rose-600" },
  middle: { label: "中", cls: "bg-amber-50 text-accent-orange border border-accent-orange/20" },
  low: { label: "低", cls: "bg-mist-soft text-ink/50" },
};

/** ヨミ先頭コード→行の淡い背景(視認性)。 */
const ROW_BG: Record<string, string> = {
  "0": "bg-emerald-50/60",
  "1": "bg-teal-light/30",
  "2": "bg-teal-light/15",
  "3": "bg-sky-50/60",
  "4": "bg-amber-50/50",
  "5": "bg-amber-50/30",
  "6": "bg-mist-soft/40",
  "7": "bg-rose-50/50",
  "8": "bg-rose-50/30",
  "9": "bg-violet-50/50",
};

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; asc: boolean };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th className={cn("th cursor-pointer select-none", align === "right" && "text-right")} onClick={() => onSort(k)}>
      <span className={cn("inline-flex items-center gap-0.5", active && "text-teal-deep")}>
        {label}
        <ArrowUpDown size={11} className={cn(active ? "opacity-90" : "opacity-30")} />
        {active && <span className="text-[9px]">{sort.asc ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}

export function RepOppTable({ opps }: { opps: RepReportOpp[] }) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "amount", asc: false });

  const onSort = (k: SortKey) =>
    setSort((p) => (p.key === k ? { key: k, asc: !p.asc } : { key: k, asc: k === "yomi" || k === "risk" }));

  const sorted = [...opps].sort((a, b) => {
    let d = 0;
    switch (sort.key) {
      case "yomi": d = yomiRank(a.yomi) - yomiRank(b.yomi); break;
      case "amount": d = a.amount - b.amount; break;
      case "risk": d = riskRank(a.riskLevel) - riskRank(b.riskLevel); break;
      case "lastActivity": d = (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? ""); break;
    }
    if (d === 0) d = a.amount - b.amount;
    return sort.asc ? d : -d;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums" style={{ minWidth: 1180 }}>
        <thead>
          <tr>
            <th className="th">顧客 / 案件</th>
            <SortHeader label="ヨミ" k="yomi" sort={sort} onSort={onSort} />
            <SortHeader label="金額" k="amount" sort={sort} onSort={onSort} align="right" />
            <th className="th text-right">Weighted</th>
            <SortHeader label="重要度" k="risk" sort={sort} onSort={onSort} />
            <SortHeader label="直近商談" k="lastActivity" sort={sort} onSort={onSort} />
            <th className="th">次回AC</th>
            <th className="th">成約月(読み)</th>
            <th className="th text-right">売上(読み)</th>
            <th className="th text-right">残</th>
            <th className="th">メモ(状況)</th>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => {
            const fid = `pf-${o.id}`;
            const bg = ROW_BG[(o.yomi ?? "").charAt(0)] ?? "";
            const risk = o.riskLevel ? RISK_META[o.riskLevel] : null;
            return (
              <tr key={o.id} className={cn("border-t border-black/[0.04] hover:bg-teal-light/20 transition-colors", bg)}>
                <td className="td">
                  <Link href={`/app/opportunities/${o.id}`} className="hover:text-teal-deep">
                    {o.account ? <span className="text-ink/50">{o.account}／</span> : null}{o.name}
                  </Link>
                </td>
                <td className="td text-ink/70">{o.yomi ?? "—"}</td>
                <td className="td text-right">{formatYen(o.amount)}</td>
                <td className="td text-right text-ink/60">{formatYen(o.weighted)}</td>
                <td className="td">{risk ? <span className={cn("pill text-[10px]", risk.cls)}>{risk.label}</span> : <span className="text-ink/25">—</span>}</td>
                <td className="td text-ink/60">{o.lastActivityAt ? formatDate(o.lastActivityAt) : "—"}</td>
                <td className="td text-ink/70">{o.nextActionDate ? formatDate(o.nextActionDate) : <span className="text-rose-500">未設定</span>}</td>
                <td className="td">
                  <input type="month" name="rep_close_month" form={fid} defaultValue={o.repCloseMonth ?? ""} className="w-[124px] rounded border border-black/10 px-1.5 py-1 text-xs" />
                </td>
                <td className="td text-right">
                  <input type="number" name="rep_amount_forecast" form={fid} defaultValue={o.repAmountForecast ?? ""} placeholder="円" min={0} step={10000} className="w-[100px] rounded border border-black/10 px-1.5 py-1 text-xs text-right" />
                </td>
                <td className="td text-right">
                  <input type="number" name="rep_meetings_left" form={fid} defaultValue={o.repMeetingsLeft ?? ""} placeholder="回" min={0} max={99} className="w-[48px] rounded border border-black/10 px-1.5 py-1 text-xs text-right" />
                </td>
                <td className="td">
                  <input type="text" name="rep_status_note" form={fid} defaultValue={o.statusNote ?? ""} placeholder="状況を一言…" maxLength={120} className="w-[200px] rounded border border-black/10 px-1.5 py-1 text-xs" />
                </td>
                <td className="td">
                  <form action={saveRepForecastAction} id={fid}>
                    <input type="hidden" name="opp_id" value={o.id} />
                    <button type="submit" className="btn-ghost text-xs">保存</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink/45">
        列見出し（ヨミ／金額／重要度／直近商談）をクリックで並び替え。「読み」＝担当自身の予測。行ごとに保存できます。背景色はヨミランクを表します。
      </p>
    </div>
  );
}
