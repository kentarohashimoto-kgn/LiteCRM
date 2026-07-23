"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ArrowUp, ArrowDown, UserRound } from "lucide-react";
import { StickyGrid } from "@/components/ui/sticky-grid";
import { setProjectLeadAction } from "@/server/actions/projects";

export interface ProjectRow {
  opportunityId: string;
  oppName: string;
  accountName: string;
  ownerName: string;
  priority: "high" | "middle" | "low";
  startMonth: string | null;
  endMonth: string | null;
  isActive: boolean;
  isFuture: boolean;
  isPast: boolean;
  hasPlan: boolean;
  revenue: number;
  cost: number;
  gross: number;
  grossRate: number;
  verdict: "go" | "conditional" | "review" | null;
  latestStatus: string | null;
  latestPeriodType: string | null;
  finalActualCost: number | null;
  finalProfit: number | null;
  finalVariance: number | null;
  finalComment: string | null;
  approvedHours: number;
  approvedCost: number;
  leadAssignmentId: string | null;
  assignees: { id: string; label: string; kind: string }[];
}

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const pct = (r: number) => (r * 100).toFixed(1) + "%";
const ym = (m: string | null) => (m ? `${m.split("-")[0]}/${Number(m.split("-")[1])}` : "");
const rateCls = (r: number) => (r >= 0.4 ? "text-emerald-600" : r >= 0.25 ? "text-amber-600" : "text-rose-600");

const PRIO = { high: { label: "高", cls: "bg-rose-50 text-rose-600" }, middle: { label: "中", cls: "bg-amber-50 text-amber-700" }, low: { label: "低", cls: "bg-mist-soft text-ink/50" } } as const;
const PRIO_RANK = { high: 2, middle: 1, low: 0 } as const;
const VERDICT = { go: { label: "GO", cls: "bg-emerald-50 text-emerald-700" }, conditional: { label: "条件付き", cls: "bg-amber-50 text-amber-700" }, review: { label: "要協議", cls: "bg-rose-50 text-rose-600" } } as const;
const STATUS: Record<string, { label: string; cls: string }> = {
  on_track: { label: "順調", cls: "bg-emerald-50 text-emerald-700" },
  watch: { label: "要注意", cls: "bg-amber-50 text-amber-700" },
  over: { label: "超過", cls: "bg-rose-50 text-rose-600" },
  blocked: { label: "停滞", cls: "bg-rose-50 text-rose-600" },
};
const PERIOD: Record<string, string> = { weekly: "週次", monthly: "月次", final: "終了時" };

type SortKey = "weight" | "priority" | "revenue" | "cost" | "gross" | "grossRate" | "end" | "variance" | "approved";

/** 1.5h → "1:30" (稼働実績列の表示用) */
function hm(n: number): string {
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m === 60 ? `${h + 1}:00` : `${h}:${String(m).padStart(2, "0")}`;
}

/** 案件管理一覧。重要度×アクティブの重み付けを既定に、各列でソートできる。 */
export function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  const [sort, setSort] = useState<SortKey>("weight");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const click = (key: SortKey) => {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir(key === "grossRate" || key === "end" ? "asc" : "desc"); }
  };

  const val = (r: ProjectRow, key: SortKey): number => {
    switch (key) {
      case "priority": return PRIO_RANK[r.priority];
      case "revenue": return r.revenue;
      case "cost": return r.cost;
      case "gross": return r.gross;
      case "grossRate": return r.grossRate;
      case "end": return r.endMonth ? Number(r.endMonth.replace("-", "")) : 999999;
      case "variance": return r.finalVariance ?? -Infinity;
      case "approved": return r.approvedCost;
      case "weight":
      default:
        // 重み: アクティブ最優先 → 重要度 → 粗利率が低い(危険)ほど上
        return (r.isActive ? 1000 : r.isFuture ? 200 : 0) + PRIO_RANK[r.priority] * 100 + (1 - Math.min(1, Math.max(0, r.grossRate))) * 10;
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const d = val(a, sort) - val(b, sort);
    return dir === "asc" ? d : -d;
  });

  return (
    <StickyGrid freeze maxHeight="66vh">
      <table className="w-full text-sm tabular-nums" style={{ minWidth: 1040 }}>
        <thead className="text-ink/40 text-xs bg-mist-soft/30">
          <tr>
            <th className="th">顧客 / 案件</th>
            <Th label="重要度" k="priority" sort={sort} dir={dir} onClick={click} />
            <th className="th">担当（責任者）</th>
            <Th label="期間" k="end" sort={sort} dir={dir} onClick={click} />
            <Th label="販売" k="revenue" sort={sort} dir={dir} onClick={click} align="right" />
            <Th label="原価" k="cost" sort={sort} dir={dir} onClick={click} align="right" />
            <Th label="粗利" k="gross" sort={sort} dir={dir} onClick={click} align="right" />
            <Th label="粗利率" k="grossRate" sort={sort} dir={dir} onClick={click} align="right" />
            <th className="th">提案可否</th>
            <Th label="稼働実績(承認)" k="approved" sort={sort} dir={dir} onClick={click} align="right" />
            <th className="th">進捗 / 完了実績</th>
            <Th label="予実差" k="variance" sort={sort} dir={dir} onClick={click} align="right" />
            <th className="th">営業担当</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.04]">
          {sorted.map((r) => {
            const period = r.startMonth || r.endMonth ? `${ym(r.startMonth) || "—"}〜${ym(r.endMonth) || "—"}` : "—";
            const periodBadge = r.isActive ? { t: "進行中", c: "bg-teal-light text-teal-deep" } : r.isFuture ? { t: "予定", c: "bg-mist-soft text-ink/50" } : r.isPast ? { t: "完了", c: "bg-ink/5 text-ink/45" } : null;
            const v = r.verdict ? VERDICT[r.verdict] : null;
            const st = r.latestStatus ? STATUS[r.latestStatus] : null;
            return (
              <tr key={r.opportunityId} className="row-hover align-top">
                <td className="td">
                  <Link href={`/app/projects/${r.opportunityId}`} className="block">
                    <div className="font-medium text-ink/90">{r.accountName}</div>
                    <div className="text-xs text-teal-deep">{r.oppName}</div>
                  </Link>
                </td>
                <td className="td"><span className={`pill ${PRIO[r.priority].cls} text-[10px] font-bold`}>{PRIO[r.priority].label}</span></td>
                <td className="td"><LeadSelect row={r} /></td>
                <td className="td">
                  <div className="text-ink/70">{period}</div>
                  {periodBadge && <span className={`pill ${periodBadge.c} text-[10px] mt-0.5 inline-block`}>{periodBadge.t}</span>}
                </td>
                <td className="td text-right text-ink/70">{r.hasPlan ? yen(r.revenue) : "—"}</td>
                <td className="td text-right text-ink/70">{r.hasPlan ? yen(r.cost) : "—"}</td>
                <td className={`td text-right font-medium ${r.gross < 0 ? "text-rose-600" : ""}`}>{r.hasPlan ? yen(r.gross) : "—"}</td>
                <td className={`td text-right font-bold ${r.hasPlan ? rateCls(r.grossRate) : ""}`}>{r.hasPlan ? pct(r.grossRate) : "—"}</td>
                <td className="td">{v ? <span className={`pill ${v.cls} text-[10px] font-bold`}>{v.label}</span> : <span className="text-ink/30 text-xs">未整備</span>}</td>
                <td className="td text-right">
                  {r.approvedHours > 0 ? (
                    <div>
                      <div className={`font-medium ${r.hasPlan && r.approvedCost > r.cost ? "text-rose-600" : "text-ink/80"}`}>{yen(r.approvedCost)}</div>
                      <div className="text-[11px] text-ink/45">{hm(r.approvedHours)}</div>
                    </div>
                  ) : (
                    <span className="text-ink/30 text-xs">—</span>
                  )}
                </td>
                <td className="td">
                  {r.finalActualCost != null ? (
                    <div>
                      <span className="pill bg-ink/5 text-ink/60 text-[10px]">終了時</span>
                      <span className="text-xs text-ink/70 ml-1">着地 {yen(r.finalActualCost)}</span>
                      {r.finalProfit != null && <div className="text-[11px] text-ink/50">最終利益 {yen(r.finalProfit)}</div>}
                      {r.finalComment && <div className="text-[11px] text-ink/45 max-w-[200px] truncate" title={r.finalComment}>💬 {r.finalComment}</div>}
                    </div>
                  ) : st ? (
                    <div>
                      <span className={`pill ${st.cls} text-[10px]`}>{st.label}</span>
                      {r.latestPeriodType && <span className="text-[11px] text-ink/45 ml-1">{PERIOD[r.latestPeriodType]}</span>}
                    </div>
                  ) : (
                    <span className="text-ink/30 text-xs">実績なし</span>
                  )}
                </td>
                <td className={`td text-right ${r.finalVariance == null ? "text-ink/30" : r.finalVariance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {r.finalVariance == null ? "—" : (r.finalVariance > 0 ? "+" : "") + yen(r.finalVariance)}
                </td>
                <td className="td text-ink/60 text-xs">{r.ownerName}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </StickyGrid>
  );
}

/**
 * 責任者(対応チームのリーダー)のインライン選択。案件のアサイン(外注/社員)から1名を指名する。
 * 変更で即保存(サーバーアクション)。アサインが無い案件は登録導線を表示。
 */
function LeadSelect({ row }: { row: ProjectRow }) {
  if (row.assignees.length === 0) {
    return (
      <Link href={`/app/projects/${row.opportunityId}`} className="text-[11px] text-ink/35 hover:text-teal-deep whitespace-nowrap" title="アサインを登録すると責任者を指名できます">
        アサイン未登録
      </Link>
    );
  }
  const KIND = { external: "外注", internal: "社員" } as const;
  return (
    <form action={setProjectLeadAction} className="min-w-[120px]">
      <input type="hidden" name="opportunity_id" value={row.opportunityId} />
      <div className="inline-flex items-center gap-1">
        <UserRound size={12} className={row.leadAssignmentId ? "text-teal-deep" : "text-ink/25"} />
        <select
          name="lead_assignment_id"
          defaultValue={row.leadAssignmentId ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={`text-xs rounded-md border border-black/10 bg-white px-1.5 py-1 max-w-[130px] ${row.leadAssignmentId ? "text-ink/80 font-medium" : "text-ink/40"}`}
          title="対応チームの責任者を指名"
        >
          <option value="">未指名</option>
          {row.assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}（{KIND[a.kind as "external" | "internal"] ?? a.kind}）
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}

function Th({ label, k, sort, dir, onClick, align }: { label: string; k: SortKey; sort: SortKey; dir: "asc" | "desc"; onClick: (k: SortKey) => void; align?: "right" }) {
  const active = sort === k;
  return (
    <th className={`th ${align === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={() => onClick(k)} className={`inline-flex items-center gap-1 hover:text-ink/70 ${active ? "text-teal-deep font-bold" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} className="opacity-40" />}
      </button>
    </th>
  );
}
