"use client";

import { useMemo, useState } from "react";
import { List, CalendarDays } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { OppTable } from "./opp-table";
import { AppointmentCalendar } from "./appointment-calendar";
import { AppointmentTrendChart } from "@/components/charts/appointment-trend-chart";
import { Section } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { MONTHLY_APPOINTMENT_TARGET } from "@/lib/constants";

interface Option {
  id: string;
  name: string;
}

function parseYMD(s?: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function OppViews({
  opps,
  owners,
  products,
  sources,
  campaigns = [],
}: {
  opps: OppView[];
  owners: Option[];
  products: Option[];
  sources: Option[];
  campaigns?: Option[];
}) {
  const [view, setView] = useState<"list" | "calendar">("list");

  const now = new Date();
  const openOpps = useMemo(() => opps.filter((o) => o.status === "open"), [opps]);

  // 当月/来月/再来月のアポ件数(next_action_date基準, open)
  const monthSummary = useMemo(() => {
    return [0, 1, 2].map((offset) => {
      const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const y = ref.getFullYear();
      const m = ref.getMonth();
      const count = openOpps.filter((o) => {
        const d = parseYMD(o.next_action_date);
        return d && d.getFullYear() === y && d.getMonth() === m;
      }).length;
      return {
        label: `${y}年${m + 1}月`,
        offset,
        count,
        target: MONTHLY_APPOINTMENT_TARGET,
        rate: MONTHLY_APPOINTMENT_TARGET ? count / MONTHLY_APPOINTMENT_TARGET : 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOpps]);

  // 過去からの商談数推移(created_at基準, 直近9ヶ月+先2ヶ月予定)
  const trend = useMemo(() => {
    const buckets: { label: string; count: number; isFuture?: boolean }[] = [];
    for (let offset = -8; offset <= 2; offset++) {
      const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const y = ref.getFullYear();
      const m = ref.getMonth();
      const isFuture = offset > 0;
      const count = isFuture
        ? openOpps.filter((o) => {
            const d = parseYMD(o.next_action_date);
            return d && d.getFullYear() === y && d.getMonth() === m;
          }).length
        : opps.filter((o) => {
            const d = parseYMD(o.created_at);
            return d && d.getFullYear() === y && d.getMonth() === m;
          }).length;
      buckets.push({ label: `${String(y).slice(2)}/${m + 1}`, count, isFuture });
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opps, openOpps]);

  // カレンダー対象: 当月・来月
  const cal1 = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const cal2 = { year: next.getFullYear(), month: next.getMonth() + 1 };

  // 担当者の色凡例(当月・来月に予定がある担当)
  const ownerLegend = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const o of openOpps) {
      const d = parseYMD(o.next_action_date);
      if (!d || !o.owner) continue;
      const inWindow =
        (d.getFullYear() === cal1.year && d.getMonth() === cal1.month - 1) ||
        (d.getFullYear() === cal2.year && d.getMonth() === cal2.month - 1);
      if (inWindow) map.set(o.owner.id, { name: o.owner.name, color: o.owner.avatarColor ?? "#008C8C" });
    }
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOpps]);

  return (
    <div className="space-y-4">
      {/* ビュー切替 */}
      <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5">
        <TabBtn active={view === "list"} onClick={() => setView("list")} icon={<List size={15} />} label="一覧" />
        <TabBtn active={view === "calendar"} onClick={() => setView("calendar")} icon={<CalendarDays size={15} />} label="カレンダー" />
      </div>

      {view === "list" ? (
        <OppTable opps={opps} owners={owners} products={products} sources={sources} campaigns={campaigns} />
      ) : (
        <div className="space-y-5">
          {/* 月次アポ件数 vs 目標 */}
          <div className="card overflow-x-auto">
            <div className="px-5 pt-4 pb-3 border-b border-black/[0.04] flex items-center justify-between">
              <h2 className="section-title">月次アポ件数 vs 目標</h2>
              <span className="text-xs text-ink/40">目標(暫定) {MONTHLY_APPOINTMENT_TARGET}件/月</span>
            </div>
            <table className="w-full">
              <thead className="border-b border-black/[0.06]">
                <tr>
                  <th className="th">対象月</th>
                  <th className="th text-right">アポ予定</th>
                  <th className="th text-right">目標</th>
                  <th className="th text-right">達成率</th>
                  <th className="th w-1/3">進捗</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {monthSummary.map((m) => {
                  const reached = m.count >= m.target;
                  return (
                    <tr key={m.offset} className="row-hover">
                      <td className="td font-medium">
                        {m.label}
                        {m.offset === 0 && <span className="ml-2 pill bg-teal-light text-teal-deep text-[10px]">当月</span>}
                      </td>
                      <td className="td text-right tabular-nums text-lg font-bold">{m.count}</td>
                      <td className="td text-right tabular-nums text-ink/50">{m.target}</td>
                      <td className={cn("td text-right tabular-nums font-semibold", reached ? "text-teal-deep" : "text-accent-orange")}>
                        {Math.round(m.rate * 100)}%
                      </td>
                      <td className="td">
                        <div className="h-2 w-full rounded-full bg-mist-soft overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", reached ? "bg-teal-primary" : "bg-accent-orange")}
                            style={{ width: `${Math.min(100, Math.round(m.rate * 100))}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 商談数の推移 */}
          <Section title="商談数の推移(実績／予定)">
            <AppointmentTrendChart data={trend} />
            <p className="text-[11px] text-ink/40 mt-2">
              実績(濃色)=作成日ベースの商談獲得数。予定(淡色)=次アクション予定日ベースのアポ件数。
            </p>
          </Section>

          {/* 担当者凡例 */}
          {ownerLegend.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
              <span className="text-[11px] text-ink/40">担当:</span>
              {ownerLegend.map((o) => (
                <span key={o.name} className="inline-flex items-center gap-1 text-[11px] text-ink/70">
                  <span className="w-2 h-2 rounded-full" style={{ background: o.color }} />
                  {o.name}
                </span>
              ))}
            </div>
          )}

          {/* カレンダー(当月・来月) */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="card card-pad">
              <AppointmentCalendar year={cal1.year} month={cal1.month} opps={openOpps} />
            </div>
            <div className="card card-pad">
              <AppointmentCalendar year={cal2.year} month={cal2.month} opps={openOpps} />
            </div>
          </div>

          <p className="text-xs text-ink/40 leading-relaxed">
            ※ カレンダーは進行中商談の<b>次アクション予定日</b>を「アポ予定」として表示しています。
            時刻(何時のアポか)は今後データ整備のうえ対応します。日付セルの色丸は担当者、クリックで商談詳細へ移動します。
          </p>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-teal-primary text-white" : "text-ink/60 hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
