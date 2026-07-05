"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_MAP } from "@/lib/constants";
import type { ProposalOppRow } from "@/server/actions/proposals";
import { formatYen, cn } from "@/lib/utils";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 提案タブ: 提案書が必要な案件の一覧と進捗。
 * 期限超過/直近を強調し、最新提出バージョンへ直接アクセスできる。
 */
export function ProposalBoard({ rows }: { rows: ProposalOppRow[] }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const t = today();

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => (!openOnly || r.status === "open") && (!statusFilter || (r.proposal_status ?? "not_started") === statusFilter),
      ),
    [rows, statusFilter, openOnly],
  );

  const open = rows.filter((r) => r.status === "open");
  const overdue = open.filter((r) => r.proposal_due_date && r.proposal_due_date < t && r.proposal_status !== "submitted");
  const inProgress = open.filter((r) => r.proposal_status !== "submitted");
  const submitted = open.filter((r) => r.proposal_status === "submitted");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="提案が必要な案件" value={open.length} />
        <SummaryCard label="対応中(未提出)" value={inProgress.length} tone={inProgress.length > 0 ? "amber" : undefined} />
        <SummaryCard label="期限超過" value={overdue.length} tone={overdue.length > 0 ? "rose" : undefined} />
        <SummaryCard label="提出済み" value={submitted.length} tone="teal" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setStatusFilter("")}
          className={cn("pill border", !statusFilter ? "bg-teal-primary text-white border-teal-primary" : "bg-white text-ink/60 border-black/10")}
        >
          すべて
        </button>
        {PROPOSAL_STATUSES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStatusFilter(statusFilter === s.key ? "" : s.key)}
            className={cn("pill border", statusFilter === s.key ? "bg-teal-primary text-white border-teal-primary" : "bg-white text-ink/60 border-black/10")}
          >
            {s.label}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink/50 cursor-pointer">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-teal-primary" />
          商談中のみ
        </label>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">顧客 / 案件</th>
              <th className="th">ヨミ</th>
              <th className="th text-right">金額</th>
              <th className="th">担当</th>
              <th className="th">提案の進捗</th>
              <th className="th">提出期限</th>
              <th className="th">最新の提案書</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {filtered.map((r) => {
              const st = PROPOSAL_STATUS_MAP[r.proposal_status ?? "not_started"];
              const isOverdue = r.proposal_due_date && r.proposal_due_date < t && r.proposal_status !== "submitted";
              const link = r.latest?.url ?? r.latest?.fileUrl ?? null;
              return (
                <tr key={r.id} className="row-hover">
                  <td className="td max-w-[260px]">
                    <Link href={`/app/opportunities/${r.id}`} className="block">
                      <span className="font-medium text-ink hover:text-teal-deep truncate block">{r.account_name ?? "—"}</span>
                      <span className="text-xs text-ink/45 truncate block">{r.name}</span>
                    </Link>
                  </td>
                  <td className="td text-xs text-ink/70">{r.yomi ?? "—"}</td>
                  <td className="td text-right font-semibold tabular-nums">{formatYen(r.amount)}</td>
                  <td className="td text-xs text-ink/70">{r.owner_name}</td>
                  <td className="td">
                    {st ? <span className={`pill ${st.color}`}>{st.label}</span> : <span className="pill bg-black/[0.05] text-ink/50">未設定</span>}
                  </td>
                  <td className="td">
                    {r.proposal_due_date ? (
                      <span className={cn("text-xs tabular-nums", isOverdue ? "text-rose-600 font-semibold" : "text-ink/70")}>
                        {r.proposal_due_date}
                        {isOverdue && " 超過"}
                      </span>
                    ) : (
                      <span className="text-xs text-ink/30">未設定</span>
                    )}
                  </td>
                  <td className="td">
                    {r.latest ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="pill bg-teal-light text-teal-deep shrink-0">v{r.latest.version} 最新</span>
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-deep hover:underline truncate max-w-[180px]">
                            {r.latest.url ? <ExternalLink size={12} /> : <Paperclip size={12} />}
                            {r.latest.title ?? `提案書 v${r.latest.version}`}
                          </a>
                        ) : (
                          <span className="text-ink/60 truncate max-w-[180px]">{r.latest.title ?? `提案書 v${r.latest.version}`}</span>
                        )}
                        <span className="text-ink/35 shrink-0">{r.latest.submitted_at}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-ink/30 inline-flex items-center gap-1"><FileText size={12} /> 未提出</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="td text-center text-ink/40 py-10">
                  提案書が必要な案件はありません。案件詳細の「提案書」セクションでフラグを立てるとここに表示されます。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink/35">
        既定は「提案書なしで成約」。開発案件・大型案件などソリューション提案で差別化する案件だけフラグを立てて、ここで進捗と期限を管理します。
      </p>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "rose" | "amber" | "teal" }) {
  return (
    <div className="card card-pad">
      <div className="text-xs text-ink/50">{label}</div>
      <div className={cn("text-2xl font-bold mt-1 tabular-nums", tone === "rose" && "text-rose-600", tone === "amber" && "text-amber-600", tone === "teal" && "text-teal-deep")}>
        {value}
      </div>
    </div>
  );
}
