"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, TriangleAlert, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { enableProjectManagementAction } from "@/server/actions/projects";
import { StickyGrid } from "@/components/ui/sticky-grid";

export interface CandidateView {
  opportunityId: string;
  oppName: string;
  accountName: string;
  ownerName: string;
  status: string;
  stage: string | null;
  amount: number;
  startMonth: string | null;
  endMonth: string | null;
  hasPlan: boolean;
  tier: "won" | "large_open";
  reason: string;
}

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const ym = (m: string | null) => (m ? `${m.split("-")[0]}/${Number(m.split("-")[1])}` : "");

const STAGE_LABEL: Record<string, string> = {
  lead_acquired: "リード獲得", meeting_scheduled: "商談設定", meeting_done: "商談実施",
  proposal_sent: "提案済み", internal_review: "社内検討", won: "受注", lost: "失注",
};

type Filter = "all" | "won" | "large_open";
type SortKey = "date" | "amount" | "status" | "account" | "owner";

const TIER_RANK = { won: 1, large_open: 0 } as const;
/** 期間の並び替え用の数値。未推定は null（常に末尾へ）。 */
const dateVal = (m: string | null): number | null => (m ? Number(m.replace("-", "")) : null);

/** 原価管理「対象候補」一覧。ヘッダー固定・日程が直近順を既定に、各列でソートできる。 */
export function CandidatesTable({ rows }: { rows: CandidateView[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc"); // 直近(新しい期間)が上

  const wonCount = rows.filter((r) => r.tier === "won").length;
  const openCount = rows.filter((r) => r.tier === "large_open").length;

  const click = (key: SortKey) => {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir(key === "account" || key === "owner" ? "asc" : "desc"); }
  };

  const shown = useMemo(() => {
    const filtered = rows.filter((r) => filter === "all" || r.tier === filter);
    return [...filtered].sort((a, b) => {
      let d = 0;
      switch (sort) {
        case "amount": d = a.amount - b.amount; break;
        case "status": d = TIER_RANK[a.tier] - TIER_RANK[b.tier]; break;
        case "account": d = a.accountName.localeCompare(b.accountName, "ja"); break;
        case "owner": d = a.ownerName.localeCompare(b.ownerName, "ja"); break;
        case "date":
        default: {
          const av = dateVal(a.startMonth), bv = dateVal(b.startMonth);
          if (av === null && bv === null) d = 0;
          else if (av === null) return 1; // 未推定は常に末尾
          else if (bv === null) return -1;
          else d = av - bv;
          break;
        }
      }
      return dir === "asc" ? d : -d;
    });
  }, [rows, filter, sort, dir]);

  const Seg = ({ v, label, n }: { v: Filter; label: string; n: number }) => (
    <button type="button" onClick={() => setFilter(v)} className={`seg ${filter === v ? "seg-on" : "seg-off"}`}>
      {label}<span className="ml-1 text-[10px] opacity-60">{n}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-ink/50 max-w-2xl">
          原価管理されていない案件のうち、<span className="font-medium text-ink/70">受注済み（デリバリーが発生＝原価管理すべき）</span>と大型商談（先行計画すべき）を抽出しています。「対象化」で原価計画を作成し、詳細へ進めます。
        </p>
        <div className="inline-flex items-center gap-0.5 rounded-xl bg-mist-soft p-1 shrink-0">
          <Seg v="all" label="すべて" n={rows.length} />
          <Seg v="won" label="受注済み" n={wonCount} />
          <Seg v="large_open" label="大型商談" n={openCount} />
        </div>
      </div>

      <StickyGrid freeze freezeLast maxHeight="64vh">
        <table className="w-full text-sm tabular-nums" style={{ minWidth: 860 }}>
          <thead className="text-ink/40 text-xs bg-mist-soft/30">
            <tr>
              <Th label="顧客 / 案件" k="account" sort={sort} dir={dir} onClick={click} />
              <Th label="状況" k="status" sort={sort} dir={dir} onClick={click} />
              <Th label="金額" k="amount" sort={sort} dir={dir} onClick={click} align="right" />
              <Th label="推定期間" k="date" sort={sort} dir={dir} onClick={click} />
              <th className="th">候補理由</th>
              <Th label="担当" k="owner" sort={sort} dir={dir} onClick={click} />
              <th className="th text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {shown.map((r) => (
              <tr key={r.opportunityId} className="row-hover align-top">
                <td className="td">
                  <Link href={`/app/opportunities/${r.opportunityId}`} className="block">
                    <div className="font-medium text-ink/90">{r.accountName}</div>
                    <div className="text-xs text-teal-deep">{r.oppName}</div>
                  </Link>
                </td>
                <td className="td">
                  {r.tier === "won" ? (
                    <span className="pill bg-emerald-50 text-emerald-700 text-[10px] font-bold">受注済み</span>
                  ) : (
                    <span className="pill bg-sky-50 text-sky-700 text-[10px] font-bold">商談中</span>
                  )}
                  {r.stage && <div className="text-[11px] text-ink/45 mt-0.5">{STAGE_LABEL[r.stage] ?? r.stage}</div>}
                </td>
                <td className="td text-right font-medium text-ink/80">{yen(r.amount)}</td>
                <td className="td text-ink/70">
                  {r.startMonth ? `${ym(r.startMonth)}〜${ym(r.endMonth)}` : <span className="text-ink/30">未推定</span>}
                </td>
                <td className="td">
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink/55">
                    {r.tier === "won" ? <TriangleAlert size={12} className="text-amber-500" /> : null}
                    {r.reason}
                  </span>
                  {r.hasPlan && <span className="pill bg-violet-50 text-violet-600 text-[10px] ml-1">計画あり</span>}
                </td>
                <td className="td text-ink/60 text-xs">{r.ownerName}</td>
                <td className="td text-right">
                  <form action={enableProjectManagementAction}>
                    <input type="hidden" name="opportunity_id" value={r.opportunityId} />
                    <button type="submit" className="inline-flex items-center gap-1 rounded-lg bg-teal-primary px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-deep transition-colors">
                      <CheckCircle2 size={13} /> 対象化
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StickyGrid>
      {shown.length === 0 && <p className="py-8 text-center text-sm text-ink/40">該当する候補はありません。</p>}
    </div>
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
