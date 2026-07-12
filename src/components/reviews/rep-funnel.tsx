import { Filter } from "lucide-react";
import { formatYen, cn } from "@/lib/utils";
import type { FunnelBucket } from "@/lib/data/rep-report";

/** ヨミ先頭コード→バー色(視認性)。 */
const BAR_COLOR: Record<string, string> = {
  "0": "bg-emerald-400",
  "1": "bg-teal-primary",
  "2": "bg-teal-400",
  "3": "bg-sky-400",
  "4": "bg-accent-orange",
  "5": "bg-amber-300",
  "6": "bg-ink/25",
  "7": "bg-rose-400",
  "8": "bg-rose-300",
  "9": "bg-violet-400",
};

/** ヨミ別のファネルサマリー(件数＋金額)。 */
export function RepFunnel({ funnel }: { funnel: FunnelBucket[] }) {
  const max = Math.max(1, ...funnel.map((b) => b.count));
  return (
    <section className="card">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/[0.04]">
        <h2 className="section-title">
          <Filter size={15} className="text-teal-primary" />
          ヨミ ファネル
        </h2>
      </div>
      <div className="p-5 pt-4 space-y-2">
        {funnel.length === 0 ? (
          <div className="text-center py-6 text-sm text-ink/40">案件がありません。</div>
        ) : (
          funnel.map((b) => (
            <div key={b.code} className="flex items-center gap-3">
              <div className="w-20 shrink-0 text-xs text-ink/70">{b.label}</div>
              <div className="flex-1 h-6 rounded bg-mist-soft/50 overflow-hidden">
                <div
                  className={cn("h-full rounded flex items-center px-2", BAR_COLOR[b.code] ?? "bg-ink/30")}
                  style={{ width: `${Math.max(8, (b.count / max) * 100)}%` }}
                >
                  <span className="text-[11px] font-bold text-white tabular-nums">{b.count}</span>
                </div>
              </div>
              <div className="w-28 shrink-0 text-right text-xs tabular-nums text-ink/70">{formatYen(b.amount)}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
