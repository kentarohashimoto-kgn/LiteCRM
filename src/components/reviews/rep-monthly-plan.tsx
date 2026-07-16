"use client";

import { useState } from "react";
import { PanelRightOpen } from "lucide-react";
import { formatYen } from "@/lib/utils";
import { YomiBadge } from "@/components/ui/badges";
import { RepOppDrawer } from "@/components/reviews/rep-opp-drawer";
import type { MonthPlan } from "@/lib/data/rep-report";

/**
 * 月別ヨミモード: 今月〜2ヶ月先の各月に「いつ・どの顧客を・どのヨミで成約する予定か」を
 * 3列で一覧表示する。案件をクリックすると右ペイン(サイドパネル)が開き、この画面に
 * とどまったままヨミ・成約予定(月)・金額などをその場で編集できる(保存で列に即反映)。
 */
export function RepMonthlyPlan({
  plan,
  total,
  ownerId,
  members,
}: {
  plan: MonthPlan[];
  total: number;
  ownerId: string;
  members: { id: string; name: string }[];
}) {
  // ドロワーのナビ(前/次)は「月順に並べた全案件」を走査する。
  const flat = plan.flatMap((m) => m.opps);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-ink/50">
          受注見込月で集計。案件をクリックすると右のパネルでヨミ・成約予定(月)・金額をその場で編集できます（保存で列に即反映）。
        </p>
        <div className="text-xs text-ink/50 whitespace-nowrap">
          3ヶ月見込 合計 <span className="font-semibold text-ink tabular-nums">{formatYen(total)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {plan.map((m) => (
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
              <p className="text-xs text-ink/35 py-4 text-center">成約予定の案件はありません</p>
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
                        <div className="flex items-center gap-1 text-xs font-medium text-ink group-hover:text-teal-deep">
                          <span className="truncate" title={o.account ?? o.name}>{o.account ?? o.name}</span>
                          <PanelRightOpen size={12} className="shrink-0 text-ink/25 group-hover:text-teal-deep" />
                        </div>
                        {o.account && o.name !== o.account && (
                          <div className="text-[10px] text-ink/45 truncate" title={o.name}>{o.name}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <YomiBadge yomi={o.yomi} />
                        <span className="text-[10px] text-ink/55 tabular-nums">{formatYen(o.amount)}</span>
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
