import { formatYen } from "@/lib/utils";
import { YomiBadge } from "@/components/ui/badges";
import type { MonthPlan } from "@/lib/data/rep-report";

/**
 * 月別ヨミモード: 今月〜2ヶ月先の各月に「いつ・どの顧客を・どのヨミで成約する予定か」を
 * 3列で一覧表示する。列ヘッダに売上見込(合計)、その下に対象案件をヨミ順で並べる。
 */
export function RepMonthlyPlan({ plan, total }: { plan: MonthPlan[]; total: number }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-ink/50">
          担当の読み(成約タイミング)を優先し、未設定は受注見込月で集計。いつ・どの顧客を成約予定かを俯瞰できます。
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

            {/* 対象案件(ヨミ順) */}
            {m.opps.length === 0 ? (
              <p className="text-xs text-ink/35 py-4 text-center">成約予定の案件はありません</p>
            ) : (
              <ul className="space-y-1.5">
                {m.opps.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-ink truncate" title={o.account ?? o.name}>
                        {o.account ?? o.name}
                      </div>
                      {o.account && o.name !== o.account && (
                        <div className="text-[10px] text-ink/45 truncate" title={o.name}>{o.name}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <YomiBadge yomi={o.yomi} />
                      <span className="text-[10px] text-ink/55 tabular-nums">{formatYen(o.amount)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
