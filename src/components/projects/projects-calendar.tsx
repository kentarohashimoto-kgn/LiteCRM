"use client";

import Link from "next/link";
import { CalendarRange } from "lucide-react";

export interface CalendarRow {
  opportunityId: string;
  accountName: string;
  oppName: string;
  priority: "high" | "middle" | "low";
  startMonth: string | null; // YYYY-MM
  endMonth: string | null; // YYYY-MM
  isActive: boolean;
  isFuture: boolean;
  isPast: boolean;
  revenue: number;
  grossRate: number;
  hasPlan: boolean;
  monthly: { month: string; revenue: number }[]; // 月別の販売計画
}

const PRIO = {
  high: { label: "高", cls: "bg-rose-50 text-rose-600" },
  middle: { label: "中", cls: "bg-amber-50 text-amber-700" },
  low: { label: "低", cls: "bg-mist-soft text-ink/50" },
} as const;

const yenShort = (n: number): string => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};
const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

/** "YYYY-MM" を +1 する。 */
function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo >= 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}
/** start..end(YYYY-MM) を包含する連続月配列。暴走防止に最大36ヶ月。 */
function enumerateMonths(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start, guard = 0;
  while (guard++ < 36) {
    out.push(cur);
    if (cur === end) break;
    cur = nextMonth(cur);
  }
  return out;
}

/**
 * 原価管理カレンダー（タイムライン）。案件ごとに何月〜何月まで実施かを横並びで俯瞰する。
 * バーは計画期間、セル内の金額は月別の販売計画。当月列を強調する。
 */
export function ProjectsCalendar({ rows, nowMonth }: { rows: CalendarRow[]; nowMonth: string }) {
  const withPeriod = rows.filter((r) => r.startMonth && r.endMonth);
  const noPeriod = rows.filter((r) => !(r.startMonth && r.endMonth));

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center">
        <CalendarRange size={28} className="mx-auto text-ink/25 mb-2" />
        <p className="text-sm text-ink/50">原価管理対象の案件がまだありません。</p>
      </div>
    );
  }

  // 全体の月ウィンドウ（当月は必ず含める）
  const monthsPool = new Set<string>([nowMonth]);
  for (const r of withPeriod) {
    if (r.startMonth) monthsPool.add(r.startMonth);
    if (r.endMonth) monthsPool.add(r.endMonth);
    for (const m of r.monthly) if (m.month) monthsPool.add(m.month);
  }
  const sortedPool = [...monthsPool].sort();
  const windowStart = sortedPool[0];
  const windowEnd = sortedPool[sortedPool.length - 1];
  const months = enumerateMonths(windowStart, windowEnd);

  const label = (m: string) => {
    const [y, mo] = m.split("-");
    return { y, mo: Number(mo) };
  };
  const revByMonth = (r: CalendarRow) => new Map(r.monthly.map((x) => [x.month, x.revenue]));

  const COL = 68; // 月列の幅(px)
  const NAME = 220; // 案件列の幅(px)

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink/45">
        バー＝計画期間、セル内金額＝月別の販売計画。<span className="text-teal-deep font-medium">当月</span>を強調しています。横スクロールで全期間を確認できます。
      </p>
      <div className="overflow-x-auto rounded-xl border border-black/[0.06]">
        <div style={{ minWidth: NAME + months.length * COL }}>
          {/* ヘッダ: 月 */}
          <div className="flex sticky top-0 z-10 bg-mist-soft/60 backdrop-blur text-xs text-ink/50 border-b border-black/[0.06]">
            <div className="shrink-0 px-3 py-2 font-medium" style={{ width: NAME }}>案件 / 顧客</div>
            {months.map((m) => {
              const { y, mo } = label(m);
              const isNow = m === nowMonth;
              const isJan = mo === 1;
              return (
                <div
                  key={m}
                  className={`shrink-0 text-center py-2 border-l ${isNow ? "bg-teal-light/60 text-teal-deep font-bold" : isJan ? "border-black/10" : "border-black/[0.04]"}`}
                  style={{ width: COL }}
                >
                  <div className="leading-tight">{mo}月</div>
                  <div className="text-[10px] text-ink/35 leading-tight">{isJan || m === windowStart ? `${y}` : ""}</div>
                </div>
              );
            })}
          </div>

          {/* 行: 案件 */}
          <div className="divide-y divide-black/[0.04]">
            {withPeriod.map((r) => {
              const rev = revByMonth(r);
              const s = r.startMonth!, e = r.endMonth!;
              return (
                <div key={r.opportunityId} className="flex row-hover items-stretch">
                  <div className="shrink-0 px-3 py-2" style={{ width: NAME }}>
                    <Link href={`/app/projects/${r.opportunityId}`} className="block">
                      <div className="flex items-center gap-1.5">
                        <span className={`pill ${PRIO[r.priority].cls} text-[10px] font-bold`}>{PRIO[r.priority].label}</span>
                        <span className="font-medium text-ink/90 text-sm truncate">{r.accountName}</span>
                      </div>
                      <div className="text-[11px] text-teal-deep truncate">{r.oppName}</div>
                      <div className="text-[10px] text-ink/40">{yen(r.revenue)}・粗利率 {(r.grossRate * 100).toFixed(0)}%</div>
                    </Link>
                  </div>
                  {months.map((m) => {
                    const inSpan = m >= s && m <= e;
                    const isStart = m === s, isEnd = m === e;
                    const isNow = m === nowMonth;
                    const amt = rev.get(m) ?? 0;
                    return (
                      <div
                        key={m}
                        className={`shrink-0 relative border-l ${isNow ? "bg-teal-light/25" : ""} ${m.endsWith("-01") ? "border-black/10" : "border-black/[0.03]"}`}
                        style={{ width: COL }}
                      >
                        {inSpan && (
                          <div
                            className={`absolute inset-y-2 flex items-center justify-center text-[10px] font-semibold text-white ${r.isPast ? "bg-ink/35" : r.isFuture ? "bg-teal-primary/45" : "bg-teal-primary"}`}
                            style={{
                              left: isStart ? 6 : 0,
                              right: isEnd ? 6 : 0,
                              borderTopLeftRadius: isStart ? 6 : 0,
                              borderBottomLeftRadius: isStart ? 6 : 0,
                              borderTopRightRadius: isEnd ? 6 : 0,
                              borderBottomRightRadius: isEnd ? 6 : 0,
                            }}
                            title={amt ? `${m}: ${yen(amt)}` : m}
                          >
                            {yenShort(amt)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {noPeriod.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <div className="text-xs font-semibold text-amber-700 mb-1.5">期間未設定（{noPeriod.length}件）— 計画の開始/終了月を設定するとカレンダーに表示されます</div>
          <div className="flex flex-wrap gap-1.5">
            {noPeriod.map((r) => (
              <Link key={r.opportunityId} href={`/app/projects/${r.opportunityId}`} className="pill bg-white text-ink/70 text-[11px] border border-amber-200 hover:border-amber-300">
                {r.accountName}<span className="text-ink/35 ml-1">{r.oppName}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
