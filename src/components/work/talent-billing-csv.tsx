"use client";

import { Download } from "lucide-react";
import type { BillingGroup } from "@/lib/talent-billing";
import { AFFILIATION_LABEL } from "@/lib/talent-billing";

const KIND: Record<string, string> = { external: "外部委託", internal: "社員", general: "全般稼働" };

const esc = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const h1 = (n: number) => (Math.round(n * 100) / 100).toString();

function download(name: string, rows: (string | number)[][]) {
  // Excel向けにBOM付きUTF-8
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * 月次の請求サマリー(所属会社ごと)と稼働実績明細のCSV出力。
 * 会社への支払・請求書の突合に使う。
 */
export function TalentBillingCsv({ groups, monthLabel }: { groups: BillingGroup[]; monthLabel: string }) {
  const summary = () => {
    const rows: (string | number)[][] = [
      ["請求元", "所属区分", "人数", "承認済み工数(h)", "承認待ち(h)", "小計(税抜・円)", "消費税率(%)", "消費税(円)", "請求額(税込・円)", "インボイス番号", "締め・支払サイト"],
    ];
    for (const g of groups) {
      rows.push([
        g.party.name, AFFILIATION_LABEL[g.party.type], g.members.length,
        h1(g.approvedHours), h1(g.pendingHours), g.subtotal, g.party.taxRate, g.tax, g.total,
        g.party.invoiceNo ?? "", g.party.paymentTerms ?? "",
      ]);
    }
    const t = groups.reduce((a, g) => ({ s: a.s + g.subtotal, x: a.x + g.tax, t: a.t + g.total, h: a.h + g.approvedHours }), { s: 0, x: 0, t: 0, h: 0 });
    rows.push(["合計", "", "", h1(t.h), "", t.s, "", t.x, t.t, "", ""]);
    download(`請求サマリー_所属会社別_${monthLabel}.csv`, rows);
  };

  const detail = () => {
    const rows: (string | number)[][] = [
      ["請求元", "所属区分", "担当者", "稼働単位", "区分", "取引先", "案件", "予定工数(h)", "承認済み工数(h)", "承認待ち(h)", "金額(税抜・円)"],
    ];
    for (const g of groups) {
      for (const m of g.members) {
        for (const d of m.details) {
          rows.push([
            g.party.name, AFFILIATION_LABEL[g.party.type], m.talentName, d.label, KIND[d.kind] ?? d.kind,
            d.accountName, d.oppName, h1(d.plannedHours), h1(d.approvedHours), h1(d.pendingHours), Math.round(d.amount),
          ]);
        }
      }
    }
    download(`稼働実績明細_${monthLabel}.csv`, rows);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={summary} className="btn-ghost inline-flex items-center gap-1.5 text-xs" title="所属会社ごとの請求額をCSVで出力">
        <Download size={13} /> 請求サマリーCSV
      </button>
      <button type="button" onClick={detail} className="btn-ghost inline-flex items-center gap-1.5 text-xs" title="担当者×案件の稼働明細をCSVで出力">
        <Download size={13} /> 稼働明細CSV
      </button>
    </div>
  );
}
