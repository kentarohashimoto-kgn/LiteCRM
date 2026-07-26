"use client";

import { useState } from "react";
import { PanelRightOpen, Activity, CheckCheck } from "lucide-react";
import { formatYen, cn } from "@/lib/utils";
import { YomiBadge } from "@/components/ui/badges";
import { RepOppDrawer } from "@/components/reviews/rep-opp-drawer";
import type { MonthPlan } from "@/lib/data/rep-report";

type Scope = "active" | "all";

/**
 * 月別ヨミモード: 今月〜2ヶ月先の各月に「いつ・どの顧客を・どのヨミで成約する予定か」を
 * 3列で一覧表示する。案件をクリックすると右ペイン(サイドパネル)が開き、この画面に
 * とどまったままヨミ・成約予定(月)・金額などをその場で編集できる(保存で列に即反映)。
 */
export function RepMonthlyPlan({
  plan,
  planAll,
  ownerId,
  members,
}: {
  plan: MonthPlan[]; // 進行中のみ
  planAll: MonthPlan[]; // 受注・オチ(決着済み)を含む全件
  ownerId: string;
  members: { id: string; name: string }[];
}) {
  // 表示スコープ: active(進行中だけ) / all(当月の決着=受注・オチも含む全件)
  const [scope, setScope] = useState<Scope>("active");
  const shown = scope === "all" ? planAll : plan;
  const total = shown.reduce((s, m) => s + m.total, 0);
  // ドロワーのナビ(前/次)は「月順に並べた全案件」を走査する。
  const flat = shown.flatMap((m) => m.opps);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const settledCount = planAll.reduce((s, m) => s + m.opps.filter((o) => o.outcome !== "open").length, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-ink/50">
          受注見込月で集計。案件をクリックすると右のパネルでヨミ・成約予定(月)・金額をその場で編集できます（保存で列に即反映）。
        </p>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-black/10 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setScope("active")}
              className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors", scope === "active" ? "bg-teal-primary text-white" : "text-ink/55 hover:text-ink")}
              title="進行中(未決着)の案件だけを表示"
            >
              <Activity size={13} /> 進行中のみ
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors", scope === "all" ? "bg-teal-primary text-white" : "text-ink/55 hover:text-ink")}
              title="受注・オチ(決着済み)も含めた全件を表示"
            >
              <CheckCheck size={13} /> 決着含む全件
              {settledCount > 0 && <span className={cn("ml-0.5 rounded-full px-1.5 text-[10px] font-bold", scope === "all" ? "bg-white/25" : "bg-ink/10 text-ink/60")}>{settledCount}</span>}
            </button>
          </div>
          <div className="text-xs text-ink/50 whitespace-nowrap">
            3ヶ月{scope === "all" ? "合計" : "見込"} <span className="font-semibold text-ink tabular-nums">{formatYen(total)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {shown.map((m) => (
          <div
            key={m.monthKey}
            className={
              "rounded-xl border p-3 " +
              (m.isCurrent ? "border-teal-primary/40 bg-teal-light/20" : "border-black/[0.06] bg-white")
            }
          >
            {/* 月ヘッダ + 売上見込 */}
            <div className="flex items-baseline justify-between gap-2 pb-2 mb-2 border-b border-black/[0.06]">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-ink">{m.label}</span>
                {m.isCurrent && <span className="pill bg-teal-primary text-white text-[10px]">今月</span>}
                <span className="text-[11px] text-ink/45">{m.count}件</span>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-ink tabular-nums">{formatYen(m.total)}</div>
                <div className="text-[10px] text-ink/45 tabular-nums">重み {formatYen(m.weighted)}</div>
              </div>
            </div>

            {/* 対象案件(ヨミ順)。クリックでサイドパネルを開く。 */}
            {m.opps.length === 0 ? (
              <p className="text-xs text-ink/35 py-4 text-center">{scope === "all" ? "対象の案件はありません" : "成約予定の案件はありません"}</p>
            ) : (
              <ul className="space-y-1">
                {m.opps.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setOpenIndex(flat.findIndex((x) => x.id === o.id))}
                      className="group w-full flex items-start justify-between gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-teal-light/30 transition-colors"
                      title="クリックで内容を確認しながら編集(サイドパネル)"
                    >
                      <div className="min-w-0">
                        <div className={cn("flex items-center gap-1 text-xs font-medium group-hover:text-teal-deep", o.outcome === "lost" ? "text-ink/45 line-through" : "text-ink")}>
                          <span className="truncate" title={o.account ?? o.name}>{o.account ?? o.name}</span>
                          {o.outcome === "won" && <span className="pill bg-emerald-50 text-emerald-700 text-[9px] font-bold shrink-0">受注</span>}
                          {o.outcome === "lost" && <span className="pill bg-rose-50 text-rose-600 text-[9px] font-bold shrink-0">オチ</span>}
                          <PanelRightOpen size={12} className="shrink-0 text-ink/25 group-hover:text-teal-deep" />
                        </div>
                        {o.account && o.name !== o.account && (
                          <div className="text-[10px] text-ink/45 truncate" title={o.name}>{o.name}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <YomiBadge yomi={o.yomi} />
                        <span className={cn("text-[10px] tabular-nums", o.outcome === "lost" ? "text-ink/35 line-through" : "text-ink/55")}>{formatYen(o.amount)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <RepOppDrawer
        oppId={openIndex != null ? flat[openIndex]?.id ?? null : null}
        index={openIndex ?? 0}
        total={flat.length}
        members={members}
        defaultAssignee={ownerId}
        onClose={() => setOpenIndex(null)}
        onNav={(dir) => setOpenIndex((i) => (i == null ? i : Math.min(flat.length - 1, Math.max(0, i + dir))))}
      />
    </div>
  );
}
