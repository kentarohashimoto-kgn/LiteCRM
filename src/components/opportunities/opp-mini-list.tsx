import Link from "next/link";
import type { OppView } from "@/lib/data/select";
import { formatYen, formatDate } from "@/lib/utils";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { ForecastBadge, StageBadge } from "@/components/ui/badges";
import { evaluateRisk, RISK_LABELS } from "@/lib/risk";

/** 顧客名が既知の文脈(顧客詳細)では、案件名から冗長な「顧客名＋区切り」プレフィックスを除く。 */
function oppLabel(o: OppView, showAccount: boolean): string {
  const name = o.name ?? "";
  if (showAccount) return o.account?.name ?? name;
  const acc = o.account?.name ?? "";
  if (acc) {
    const re = new RegExp("^" + acc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[_/：:・\\-]*\\s*");
    const stripped = name.replace(re, "").trim();
    if (stripped) return stripped;
  }
  return name || acc;
}

export function OppMiniList({
  opps,
  showRisk = false,
  emptyMessage = "該当する案件はありません",
  limit,
  showAccount = true,
}: {
  opps: OppView[];
  showRisk?: boolean;
  emptyMessage?: string;
  limit?: number;
  showAccount?: boolean;
}) {
  const list = limit ? opps.slice(0, limit) : opps;
  if (list.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <ul className="divide-y divide-black/[0.05]">
      {list.map((o) => {
        const risk = showRisk ? evaluateRisk(o) : null;
        return (
          <li key={o.id} className="py-2.5">
            <Link href={`/app/opportunities/${o.id}`} className="group flex items-center gap-3">
              <Avatar user={o.owner} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink group-hover:text-teal-deep" title={o.name ?? undefined}>
                    {oppLabel(o, showAccount)}
                  </span>
                  <ForecastBadge category={o.forecast_category} />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <StageBadge stage={o.stage} />
                  <span className="text-xs text-ink/40">次:{formatDate(o.next_action_date)}</span>
                </div>
                {risk && risk.reasons.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {risk.reasons.map((r) => (
                      <span key={r} className="pill bg-rose-50 text-rose-500 text-[10px]">
                        {RISK_LABELS[r]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold tabular-nums text-ink">{formatYen(o.amount)}</div>
                <div className="text-[11px] text-ink/40">確度 {o.probability}%</div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
