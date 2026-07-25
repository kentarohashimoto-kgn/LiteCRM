"use client";

import { useState } from "react";
import { MoneyInput } from "@/components/ui/money-input";
import { ArrowUpDown, PanelRightOpen } from "lucide-react";
import { formatYen, formatDate, cn } from "@/lib/utils";
import { YOMI_OPTIONS } from "@/lib/constants";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveRepForecastAction } from "@/server/actions/rep-report";
import { RepOppDrawer } from "@/components/reviews/rep-opp-drawer";
import { StickyGrid } from "@/components/ui/sticky-grid";
import { NextActionStatus } from "@/components/opportunities/next-action-status";
import type { RepReportOpp } from "@/lib/data/rep-report";

/** 要因の記入を求めるヨミ(受注/定期追い/オチ)。 */
const REASON_YOMI: Record<string, string> = {
  "0.受注": "受注の要因(勝因)を一言…",
  "6.定期追い": "定期追いに切り替える要因を一言…",
  "7.オチ": "オチた要因を一言…",
};

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

export function RepOppTable({
  opps,
  ownerId,
  weekStart,
  members,
}: {
  opps: RepReportOpp[];
  ownerId: string;
  weekStart: string;
  members: { id: string; name: string }[];
}) {
  // 既定はヨミの高い順(0.受注→9.調整中)
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "yomi", asc: true });
  // 行ごとに選択中のヨミ(要因入力欄の出し分け用)
  const [yomiSel, setYomiSel] = useState<Record<string, string>>({});
  // サイドパネル(案A): 表示中の並び順における位置
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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
    <div>
      <StickyGrid freeze freezeLast maxHeight="64vh">
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
            <th className="th">成約予定(月)</th>
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
                  <button
                    type="button"
                    onClick={() => setOpenIndex(sorted.findIndex((x) => x.id === o.id))}
                    className="text-left hover:text-teal-deep inline-flex items-start gap-1 group"
                    title="クリックで内容を確認しながら更新(サイドパネル)"
                  >
                    <span>{o.account ? <span className="text-ink/50">{o.account}／</span> : null}{o.name}</span>
                    <PanelRightOpen size={13} className="mt-0.5 shrink-0 text-ink/25 group-hover:text-teal-deep" />
                  </button>
                </td>
                <td className="td">
                  {(() => {
                    const sel = yomiSel[o.id] ?? o.yomi ?? "";
                    const changed = sel !== (o.yomi ?? "");
                    const reasonPh = changed ? REASON_YOMI[sel] : undefined;
                    return (
                      <div className="space-y-1">
                        <select
                          name="yomi"
                          form={fid}
                          value={sel}
                          onChange={(e) => setYomiSel((m) => ({ ...m, [o.id]: e.target.value }))}
                          className="w-[110px] rounded border border-black/10 px-1 py-1 text-xs bg-white"
                          title="ヨミを変更すると履歴に自動記録されます"
                        >
                          <option value="">—</option>
                          {YOMI_OPTIONS.map((y) => (
                            <option key={y.key} value={y.key}>{y.label}</option>
                          ))}
                        </select>
                        {reasonPh && (
                          <input
                            name="yomi_reason"
                            form={fid}
                            placeholder={reasonPh}
                            maxLength={200}
                            className="w-[180px] rounded border border-accent-orange/50 bg-amber-50/50 px-1.5 py-1 text-xs"
                            title="この変更の要因(成約/失注分析に使われます)"
                          />
                        )}
                        {changed && !reasonPh && <span className="block text-[10px] text-teal-deep">保存で確定</span>}
                      </div>
                    );
                  })()}
                </td>
                <td className="td text-right">
                  <MoneyInput name="amount" form={fid} defaultValue={o.amount || ""} placeholder="円" className="w-[110px] rounded border border-black/10 px-1.5 py-1 text-xs text-right" />
                </td>
                <td className="td text-right text-ink/60">{formatYen(o.weighted)}</td>
                <td className="td">{risk ? <span className={cn("pill text-[10px]", risk.cls)}>{risk.label}</span> : <span className="text-ink/25">—</span>}</td>
                <td className="td text-ink/60">{o.lastActivityAt ? formatDate(o.lastActivityAt) : "—"}</td>
                <td className="td text-ink/70">
                  {o.nextActionDate ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span>{formatDate(o.nextActionDate)}</span>
                        <NextActionStatus status={o.nextActionStatus} date={o.nextActionDate} />
                      </div>
                      {o.nextActionText && (
                        <div className="max-w-[160px] truncate text-[11px] text-ink/50" title={o.nextActionText}>{o.nextActionText}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-rose-500">未設定</span>
                  )}
                </td>
                <td className="td">
                  <input type="month" name="expected_close_month" form={fid} defaultValue={o.expectedClose ? o.expectedClose.slice(0, 7) : ""} className="w-[124px] rounded border border-black/10 px-1.5 py-1 text-xs" />
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
                    <input type="hidden" name="back_owner" value={ownerId} />
                    <input type="hidden" name="back_week" value={weekStart} />
                    <SubmitButton className="btn-ghost text-xs" pendingLabel="保存中…">保存</SubmitButton>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </StickyGrid>
      <p className="mt-2 text-xs text-ink/45">
        既定はヨミの高い順。列見出し（ヨミ／金額／重要度／直近商談）をクリックで並び替え。金額・成約予定は案件情報にそのまま反映されます（Weightedも更新）。
        ヨミもここから変更でき、履歴に自動記録されます（受注・定期追い・オチに変えるときは要因を一言入れてください。成約/失注分析の元データになります）。
        案件名クリックで、確率など詳細を確認しながら更新できるサイドパネルが開きます。
      </p>

      <RepOppDrawer
        oppId={openIndex != null ? sorted[openIndex]?.id ?? null : null}
        index={openIndex ?? 0}
        total={sorted.length}
        members={members}
        defaultAssignee={ownerId}
        onClose={() => setOpenIndex(null)}
        onNav={(dir) => setOpenIndex((i) => (i == null ? i : Math.min(sorted.length - 1, Math.max(0, i + dir))))}
      />
    </div>
  );
}
