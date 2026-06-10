"use client";

import { useMemo, useState } from "react";
import { List, CalendarDays } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { OppTable } from "./opp-table";
import { AppointmentCalendar } from "./appointment-calendar";
import { AppointmentTrendChart } from "@/components/charts/appointment-trend-chart";
import { StackedTrendChart, type StackSeries } from "@/components/charts/stacked-trend-chart";
import { Section } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { MONTHLY_APPOINTMENT_TARGET, YOMI_APPOINTMENT } from "@/lib/constants";

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
  const [trendTab, setTrendTab] = useState<"total" | "owner" | "exhibition">("total");

  const now = new Date();
  // 「アポ」= ヨミが 4.アポ の商談。初回商談日(first_meeting_date)を予定日とする。
  const apoOpps = useMemo(() => opps.filter((o) => o.yomi === YOMI_APPOINTMENT), [opps]);

  // 当月/来月/再来月のアポ件数(ヨミ=アポ × 初回商談日基準)
  const monthSummary = useMemo(() => {
    return [0, 1, 2].map((offset) => {
      const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const y = ref.getFullYear();
      const m = ref.getMonth();
      const count = apoOpps.filter((o) => {
        const d = parseYMD(o.first_meeting_date);
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
  }, [apoOpps]);

  // 推移の月バケット。過去〜当月=商談獲得(created_at)、先2ヶ月=アポ予定(初回商談日)。
  // 各月にひも付く商談リストを保持し、全体/担当者別/展示会別で再集計する。
  const buckets = useMemo(() => {
    const list: { label: string; isFuture: boolean; opps: OppView[] }[] = [];
    for (let offset = -8; offset <= 2; offset++) {
      const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const y = ref.getFullYear();
      const m = ref.getMonth();
      const isFuture = offset > 0;
      const inMonth = (o: OppView, field: "created_at" | "first_meeting_date") => {
        const d = parseYMD(o[field]);
        return !!d && d.getFullYear() === y && d.getMonth() === m;
      };
      const monthOpps = isFuture
        ? apoOpps.filter((o) => inMonth(o, "first_meeting_date"))
        : opps.filter((o) => inMonth(o, "created_at"));
      list.push({ label: `${String(y).slice(2)}/${m + 1}`, isFuture, opps: monthOpps });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opps, apoOpps]);

  const totalTrend = useMemo(
    () => buckets.map((b) => ({ label: b.label, count: b.opps.length, isFuture: b.isFuture })),
    [buckets],
  );

  const ownerTrend = useMemo(
    () =>
      buildStacked(
        buckets,
        (o) => o.owner_user_id,
        (o) => o.owner?.name ?? "未割当",
        (o) => o.owner?.avatarColor ?? "#94A3B8",
        12,
      ),
    [buckets],
  );

  const exhibitionTrend = useMemo(
    () =>
      buildStacked(
        buckets,
        (o) => o.campaign_id ?? "__none",
        (o) => o.campaign?.name ?? "展示会以外",
        (o) => (o.campaign_id ? "" : "#CBD5E1"),
        10,
      ),
    [buckets],
  );

  // カレンダー対象: 当月・来月
  const cal1 = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const cal2 = { year: next.getFullYear(), month: next.getMonth() + 1 };

  // 担当者の色凡例(当月・来月にアポ予定がある担当)
  const ownerLegend = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const o of apoOpps) {
      const d = parseYMD(o.first_meeting_date);
      if (!d || !o.owner) continue;
      const inWindow =
        (d.getFullYear() === cal1.year && d.getMonth() === cal1.month - 1) ||
        (d.getFullYear() === cal2.year && d.getMonth() === cal2.month - 1);
      if (inWindow) map.set(o.owner.id, { name: o.owner.name, color: o.owner.avatarColor ?? "#008C8C" });
    }
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apoOpps]);

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
              <h2 className="section-title">月次アポ件数 vs 目標<span className="ml-2 text-[11px] font-normal text-ink/40">ヨミ=4.アポ／初回商談日基準</span></h2>
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

          {/* 案件数の推移(全体／担当者別／展示会別) */}
          <Section
            title="案件数の推移"
            action={
              <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5 text-xs">
                <TrendTab active={trendTab === "total"} onClick={() => setTrendTab("total")} label="全体" />
                <TrendTab active={trendTab === "owner"} onClick={() => setTrendTab("owner")} label="担当者別" />
                <TrendTab active={trendTab === "exhibition"} onClick={() => setTrendTab("exhibition")} label="展示会別" />
              </div>
            }
          >
            {trendTab === "total" ? (
              <AppointmentTrendChart data={totalTrend} />
            ) : trendTab === "owner" ? (
              <>
                <StackedTrendChart data={ownerTrend.data} series={ownerTrend.series} />
                <SeriesLegend series={ownerTrend.series} />
              </>
            ) : (
              <>
                <StackedTrendChart data={exhibitionTrend.data} series={exhibitionTrend.series} />
                <SeriesLegend series={exhibitionTrend.series} />
              </>
            )}
            <p className="text-[11px] text-ink/40 mt-2">
              実績=作成日ベースの案件獲得数(過去〜当月)。予定=初回商談日ベースのアポ(ヨミ=4.アポ)件数(先2ヶ月)。
              {trendTab === "exhibition" && "「展示会以外」は展示会流入でない案件。"}
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
              <AppointmentCalendar year={cal1.year} month={cal1.month} opps={apoOpps} />
            </div>
            <div className="card card-pad">
              <AppointmentCalendar year={cal2.year} month={cal2.month} opps={apoOpps} />
            </div>
          </div>

          <p className="text-xs text-ink/40 leading-relaxed">
            ※ カレンダーは<b>ヨミ=4.アポ</b>の案件を<b>初回商談日</b>に配置しています(初回商談待ちのアポ)。
            時刻(何時のアポか)は今後データ整備のうえ対応します。日付セルの色丸は担当者、クリックで商談詳細へ移動します。
          </p>
        </div>
      )}
    </div>
  );
}

const STACK_PALETTE = [
  "#008C8C", "#F59A2A", "#3B82F6", "#8B5CF6", "#EC4899",
  "#10B981", "#EF4444", "#0EA5E9", "#A855F7", "#84CC16",
];

/** 月バケットを系列(担当者/展示会)で積み上げ集計。上位 cap 件 + その他にまとめる。 */
function buildStacked(
  buckets: { label: string; opps: OppView[] }[],
  keyOf: (o: OppView) => string,
  nameOf: (o: OppView) => string,
  colorOf: (o: OppView) => string,
  cap: number,
): { data: Record<string, string | number>[]; series: StackSeries[] } {
  const totals = new Map<string, number>();
  const sample = new Map<string, OppView>();
  for (const b of buckets) {
    for (const o of b.opps) {
      const k = keyOf(o);
      totals.set(k, (totals.get(k) ?? 0) + 1);
      if (!sample.has(k)) sample.set(k, o);
    }
  }
  let keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const capped = new Set<string>();
  if (keys.length > cap) {
    keys.slice(cap).forEach((k) => capped.add(k));
    keys = keys.slice(0, cap);
    keys.push("__other");
  }
  const data = buckets.map((b) => {
    const row: Record<string, string | number> = { label: b.label };
    keys.forEach((k) => (row[k] = 0));
    for (const o of b.opps) {
      let k = keyOf(o);
      if (capped.has(k)) k = "__other";
      row[k] = (row[k] as number) + 1;
    }
    return row;
  });
  const series: StackSeries[] = keys.map((k, i) => {
    if (k === "__other") return { key: k, name: "その他", color: "#CBD5E1" };
    const s = sample.get(k)!;
    return { key: k, name: nameOf(s), color: colorOf(s) || STACK_PALETTE[i % STACK_PALETTE.length] };
  });
  return { data, series };
}

function TrendTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 font-medium transition-colors",
        active ? "bg-teal-primary text-white" : "text-ink/55 hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

function SeriesLegend({ series }: { series: StackSeries[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1 text-[11px] text-ink/70">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
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
