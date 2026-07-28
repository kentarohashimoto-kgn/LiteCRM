import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Card, LinkButton, Section } from "@/components/ui/primitives";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { CalItem } from "@/lib/data/calendar";
import { cn } from "@/lib/utils";

/** JSTの今日を Date(UTC表現) で返す。 */
function jstNow(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function jstTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * 案件カレンダーガジェット: 当月のアポ・商談を月間グリッドで表示。
 * RPC appointment_calendar_events は RLS 準拠(invoker)のため、
 * own-onlyロール(インサイドセールス等)は自分の担当案件だけが載る。
 */
export async function CalendarGadget() {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("appointment_calendar_events");
  const items = ((data ?? []) as CalItem[]).filter((i) => i.on_date);

  const now = jstNow();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-origin
  const today = ymd(year, month, now.getUTCDate());
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0=日

  const byDate = new Map<string, CalItem[]>();
  for (const it of items) {
    const arr = byDate.get(it.on_date) ?? [];
    arr.push(it);
    byDate.set(it.on_date, arr);
  }

  // 日曜始まりの月間グリッド(前後の空セルはnull)
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Section
      title={`案件カレンダー（${year}年${month + 1}月）`}
      icon={<CalendarDays size={16} />}
      action={<LinkButton href="/app/opportunities" variant="ghost">案件一覧へ</LinkButton>}
    >
      <Card className="p-3">
        <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 mb-1">
          {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
            <div key={w} className={cn(i === 0 && "text-rose-400", i === 6 && "text-sky-400")}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-slate-100 rounded-lg overflow-hidden">
          {cells.map((day, idx) => {
            if (day == null) return <div key={idx} className="bg-slate-50 min-h-[72px]" />;
            const key = ymd(year, month, day);
            const evs = byDate.get(key) ?? [];
            const isToday = key === today;
            return (
              <div key={idx} className={cn("bg-white min-h-[72px] p-1", isToday && "bg-teal-50/70")}>
                <div className={cn(
                  "text-[11px] leading-none mb-1",
                  isToday ? "font-bold text-teal-700" : "text-slate-500",
                )}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {evs.slice(0, 2).map((e, i) => (
                    <Link
                      key={`${e.opportunity_id}-${e.meeting_id ?? i}`}
                      href={`/app/opportunities/${e.opportunity_id}`}
                      className={cn(
                        "block truncate rounded px-1 py-0.5 text-[10px] leading-tight",
                        e.kind === "appt" ? "bg-teal-100/80 text-teal-800" : "bg-slate-100 text-slate-500",
                      )}
                      title={`${e.account_name ?? ""} ${e.title}`}
                    >
                      {e.timed && <span className="font-semibold mr-0.5">{jstTime(e.at)}</span>}
                      {e.account_name ?? e.opp_name ?? e.title}
                    </Link>
                  ))}
                  {evs.length > 2 && <div className="text-[10px] text-slate-400 px-1">+{evs.length - 2}件</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </Section>
  );
}
