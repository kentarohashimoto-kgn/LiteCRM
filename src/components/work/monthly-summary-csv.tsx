"use client";

import { Download } from "lucide-react";
import type { MonthlyWorkRow } from "@/lib/data/work-log";
import { hoursToCost } from "@/lib/work-time";

const KIND: Record<string, string> = { external: "外部委託", internal: "社員", general: "全般稼働" };

/** 稼働月次サマリーのCSVダウンロード(委託先への支払明細・請求突合用)。Excel向けにBOM付きUTF-8。 */
export function MonthlySummaryCsv({ rows, monthLabel }: { rows: MonthlyWorkRow[]; monthLabel: string }) {
  const download = () => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const h1 = (n: number) => (Math.round(n * 100) / 100).toString();
    const header = ["稼働者", "区分", "役割", "取引先", "案件", "予定工数(h)", "承認済み工数(h)", "承認待ち(h)", "予実差(h)", "単価(円)", "単価種別", "金額(承認済み・円)"];
    const lines = rows.map((r) => {
      const amount = Math.round(hoursToCost(r.approvedHours, r.costRate, r.rateUnit, r.hoursPerMonth));
      return [
        r.label, KIND[r.kind] ?? r.kind, r.role ?? "", r.kind === "general" ? "" : r.accountName, r.kind === "general" ? "全般稼働（案件紐づけなし）" : r.oppName,
        h1(r.plannedHours), h1(r.approvedHours), h1(r.pendingHours), h1(r.approvedHours - r.plannedHours),
        r.costRate || "", r.costRate ? (r.rateUnit === "hourly" ? "時給" : "人月") : "", amount,
      ].map(esc).join(",");
    });
    const total = rows.reduce((s, r) => s + Math.round(hoursToCost(r.approvedHours, r.costRate, r.rateUnit, r.hoursPerMonth)), 0);
    const csv = "﻿" + [header.join(","), ...lines, ["合計", "", "", "", "", "", "", "", "", "", "", total].join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `稼働月次サマリー_${monthLabel}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <button type="button" onClick={download} className="btn-ghost inline-flex items-center gap-1.5 text-xs" title="この月のサマリーをCSVでダウンロード(支払明細・請求突合用)">
      <Download size={13} /> CSV出力
    </button>
  );
}
