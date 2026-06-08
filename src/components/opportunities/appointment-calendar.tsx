"use client";

import Link from "next/link";
import type { OppView } from "@/lib/data/select";
import { cn, formatDateFull } from "@/lib/utils";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function parseYMD(s?: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** 当月/来月などの単月カレンダー。first_meeting_date(初回商談日)を「アポ予定日」として配置する。 */
export function AppointmentCalendar({
  year,
  month, // 1-based
  opps,
}: {
  year: number;
  month: number;
  opps: OppView[];
}) {
  const startWd = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const byDay = new Map<number, OppView[]>();
  for (const o of opps) {
    const d = parseYMD(o.first_meeting_date);
    if (d && d.getFullYear() === year && d.getMonth() === month - 1) {
      const day = d.getDate();
      const arr = byDay.get(day);
      if (arr) arr.push(o);
      else byDay.set(day, [o]);
    }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const now = new Date();
  const isToday = (d: number) =>
    now.getFullYear() === year && now.getMonth() === month - 1 && now.getDate() === d;

  const monthTotal = Array.from(byDay.values()).reduce((s, l) => s + l.length, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-bold text-ink">
          {year}年{month}月
        </h3>
        <span className="text-xs text-ink/50">
          アポ予定 <b className="text-teal-deep">{monthTotal}</b> 件
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={i === 0 ? "text-rose-400" : i === 6 ? "text-teal-primary" : "text-ink/40"}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => (
          <div
            key={i}
            className={cn(
              "min-h-[88px] rounded-lg border p-1",
              d ? "bg-white border-black/[0.05]" : "border-transparent",
            )}
          >
            {d && (
              <>
                <div
                  className={cn(
                    "text-[11px] font-medium mb-0.5",
                    isToday(d)
                      ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-primary text-white"
                      : i % 7 === 0
                        ? "text-rose-400"
                        : "text-ink/50",
                  )}
                >
                  {d}
                </div>
                <div className="space-y-0.5">
                  {(byDay.get(d) ?? []).slice(0, 3).map((o) => {
                    const color = o.owner?.avatarColor ?? "#94A3B8";
                    return (
                      <Link
                        key={o.id}
                        href={`/app/opportunities/${o.id}`}
                        className="group/ev relative flex items-center gap-1 rounded px-1 py-0.5 hover:brightness-95"
                        style={{ background: `${color}22`, borderLeft: `3px solid ${color}` }}
                      >
                        <span className="truncate text-[10px] text-ink/80">{o.account?.name ?? o.name}</span>
                        {/* ホバー詳細(クリック不要) */}
                        <span className="pointer-events-none hidden group-hover/ev:flex flex-col absolute left-0 bottom-full z-50 mb-1 w-max max-w-[230px] rounded-lg bg-white shadow-lg border border-black/10 p-2 text-left">
                          <span className="text-[11px] font-semibold text-ink">{o.account?.name ?? o.name}</span>
                          <span className="text-[10px] text-ink/60">
                            初回商談日: {formatDateFull(o.first_meeting_date)}
                            <span className="text-ink/35">（時刻未定）</span>
                          </span>
                          <span className="text-[10px] text-ink/60 inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                            担当: {o.owner?.name ?? "未割当"}
                          </span>
                          <span className="text-[10px] text-ink/45">ヨミ: {o.yomi ?? "—"}</span>
                        </span>
                      </Link>
                    );
                  })}
                  {(byDay.get(d)?.length ?? 0) > 3 && (
                    <div className="text-[10px] text-ink/40 px-1">+{(byDay.get(d)!.length - 3)}件</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
