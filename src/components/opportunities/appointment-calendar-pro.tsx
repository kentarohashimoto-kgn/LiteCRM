"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, List, CalendarDays, Columns3, Square } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { setAppointmentAtAction } from "@/server/actions/opportunities";
import { YomiBadge } from "@/components/ui/badges";
import { Avatar } from "@/components/ui/primitives";
import { YOMI_APPOINTMENT } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface Option { id: string; name: string; }
type View = "list" | "month" | "week" | "day";
const WD = ["日", "月", "火", "水", "木", "金", "土"];

// --- date helpers (local) ---
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(startOfDay(d), -d.getDay());
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);
const fmtHM = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** アポの日時(appointment_atがあれば時刻あり、なければ初回商談日=終日)。 */
function apptDate(o: OppView): Date | null {
  if (o.appointment_at) return new Date(o.appointment_at);
  if (o.first_meeting_date) { const [y, m, dd] = o.first_meeting_date.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, dd); }
  return null;
}
const hasTime = (o: OppView) => !!o.appointment_at;
/** datetime-local 入力用の値。 */
function toLocalInput(o: OppView): string {
  const d = apptDate(o);
  if (!d) return "";
  if (!o.appointment_at) d.setHours(10, 0, 0, 0);
  return `${ymd(d)}T${fmtHM(d)}`;
}

export function AppointmentCalendarPro({ opps, owners }: { opps: OppView[]; owners: Option[] }) {
  const [items, setItems] = useState<OppView[]>(opps);
  useEffect(() => setItems(opps), [opps]);
  const [view, setView] = useState<View>("list");
  const [cursor, setCursor] = useState<Date>(startOfDay(new Date()));
  const [ownerFilter, setOwnerFilter] = useState("");

  const appts = useMemo(() => {
    return items
      .filter((o) => o.yomi === YOMI_APPOINTMENT && apptDate(o))
      .filter((o) => !ownerFilter || o.owner_user_id === ownerFilter)
      .map((o) => ({ o, at: apptDate(o)! }))
      .sort((a, b) => +a.at - +b.at);
  }, [items, ownerFilter]);

  const byDay = useMemo(() => {
    const m = new Map<string, { o: OppView; at: Date }[]>();
    for (const a of appts) { const k = ymd(a.at); (m.get(k) ?? m.set(k, []).get(k)!).push(a); }
    return m;
  }, [appts]);

  async function setTime(o: OppView, localValue: string) {
    const iso = localValue ? new Date(localValue).toISOString() : null;
    setItems((prev) => prev.map((x) => (x.id === o.id ? { ...x, appointment_at: iso ?? undefined } : x)));
    await setAppointmentAtAction({ id: o.id, iso });
  }

  const move = (n: number) => {
    if (view === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
    else if (view === "week") setCursor((c) => addDays(c, n * 7));
    else setCursor((c) => addDays(c, n));
  };
  const title = view === "month"
    ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
    : view === "week"
      ? `${startOfWeek(cursor).getMonth() + 1}/${startOfWeek(cursor).getDate()} 〜 ${addDays(startOfWeek(cursor), 6).getMonth() + 1}/${addDays(startOfWeek(cursor), 6).getDate()}`
      : `${cursor.getFullYear()}年${cursor.getMonth() + 1}月${cursor.getDate()}日(${WD[cursor.getDay()]})`;

  return (
    <div className="space-y-3">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-sm">
          <VBtn active={view === "list"} onClick={() => setView("list")} icon={<List size={14} />} label="一覧" />
          <VBtn active={view === "month"} onClick={() => setView("month")} icon={<CalendarDays size={14} />} label="月" />
          <VBtn active={view === "week"} onClick={() => setView("week")} icon={<Columns3 size={14} />} label="週" />
          <VBtn active={view === "day"} onClick={() => setView("day")} icon={<Square size={14} />} label="日" />
        </div>
        {view !== "list" && (
          <div className="inline-flex items-center gap-1">
            <button onClick={() => move(-1)} className="rounded-lg border border-black/10 p-1.5 hover:bg-mist-soft"><ChevronLeft size={15} /></button>
            <button onClick={() => setCursor(startOfDay(new Date()))} className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-mist-soft">今日</button>
            <button onClick={() => move(1)} className="rounded-lg border border-black/10 p-1.5 hover:bg-mist-soft"><ChevronRight size={15} /></button>
            <span className="ml-1 text-sm font-semibold text-ink">{title}</span>
          </div>
        )}
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="ml-auto rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
          <option value="">担当：すべて</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <span className="text-xs text-ink/45">アポ {appts.length}件</span>
      </div>

      {view === "list" && <ListView byDay={byDay} onSetTime={setTime} />}
      {view === "month" && <MonthView cursor={cursor} byDay={byDay} onPickDay={(d) => { setCursor(d); setView("day"); }} />}
      {view === "week" && <WeekView cursor={cursor} byDay={byDay} onPickDay={(d) => { setCursor(d); setView("day"); }} />}
      {view === "day" && <DayView cursor={cursor} items={byDay.get(ymd(cursor)) ?? []} onSetTime={setTime} />}

      <p className="text-[11px] text-ink/40">※ アポ=ヨミ「4.アポ」の案件。時刻を設定するとその時刻で表示され、未設定は「終日」。日/一覧ビューで時刻を入力できます。</p>
    </div>
  );
}

function ApptRow({ item, onSetTime }: { item: { o: OppView; at: Date }; onSetTime: (o: OppView, v: string) => void }) {
  const { o, at } = item;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={cn("text-xs tabular-nums shrink-0 w-14", hasTime(o) ? "text-teal-deep font-medium" : "text-ink/40")}>{hasTime(o) ? fmtHM(at) : "終日"}</span>
      {o.owner && <Avatar user={o.owner} size={20} />}
      <Link href={`/app/opportunities/${o.id}`} className="min-w-0 flex-1">
        <span className="block text-sm text-ink truncate hover:text-teal-deep">{o.account?.name}</span>
        <span className="block text-[11px] text-ink/45 truncate">{o.next_action_text ?? o.name}</span>
      </Link>
      <YomiBadge yomi={o.yomi} />
      <input type="datetime-local" defaultValue={toLocalInput(o)} onChange={(e) => onSetTime(o, e.target.value)} className="rounded-lg border border-black/10 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-teal-primary shrink-0" title="日時を設定" />
    </div>
  );
}

function ListView({ byDay, onSetTime }: { byDay: Map<string, { o: OppView; at: Date }[]>; onSetTime: (o: OppView, v: string) => void }) {
  const days = Array.from(byDay.keys()).sort();
  const today = ymd(new Date());
  const upcoming = days.filter((d) => d >= today);
  const shown = upcoming.length ? upcoming : days;
  if (shown.length === 0) return <div className="card card-pad text-sm text-ink/40 text-center py-8">アポの予定はありません</div>;
  return (
    <div className="card divide-y divide-black/[0.05]">
      {shown.map((d) => {
        const dt = new Date(d + "T00:00:00");
        return (
          <div key={d} className="px-4 py-2">
            <div className="text-xs font-semibold text-ink/60 mb-1">{dt.getMonth() + 1}/{dt.getDate()}（{WD[dt.getDay()]}）<span className="text-ink/35 ml-1">{byDay.get(d)!.length}件</span></div>
            <div className="divide-y divide-black/[0.03]">
              {byDay.get(d)!.map((it) => <ApptRow key={it.o.id} item={it} onSetTime={onSetTime} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ cursor, items, onSetTime }: { cursor: Date; items: { o: OppView; at: Date }[]; onSetTime: (o: OppView, v: string) => void }) {
  return (
    <div className="card card-pad">
      {items.length === 0 ? (
        <p className="text-sm text-ink/40 text-center py-8">この日のアポはありません</p>
      ) : (
        <div className="divide-y divide-black/[0.05]">
          {items.map((it) => <ApptRow key={it.o.id} item={it} onSetTime={onSetTime} />)}
        </div>
      )}
    </div>
  );
}

function WeekView({ cursor, byDay, onPickDay }: { cursor: Date; byDay: Map<string, { o: OppView; at: Date }[]>; onPickDay: (d: Date) => void }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = ymd(new Date());
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const list = byDay.get(ymd(d)) ?? [];
        return (
          <div key={ymd(d)} className={cn("rounded-xl border bg-white min-h-[140px] flex flex-col", ymd(d) === today ? "border-teal-primary" : "border-black/[0.06]")}>
            <button onClick={() => onPickDay(d)} className="px-2 py-1.5 border-b border-black/[0.05] text-left hover:bg-mist-soft/60">
              <span className={cn("text-xs font-semibold", d.getDay() === 0 ? "text-rose-500" : d.getDay() === 6 ? "text-blue-500" : "text-ink/70")}>{d.getMonth() + 1}/{d.getDate()}（{WD[d.getDay()]}）</span>
            </button>
            <div className="p-1.5 space-y-1 overflow-y-auto">
              {list.map((it) => (
                <Link key={it.o.id} href={`/app/opportunities/${it.o.id}`} className="block rounded-lg bg-teal-light/50 px-1.5 py-1 text-[11px] hover:bg-teal-light">
                  <span className="tabular-nums text-teal-deep mr-1">{hasTime(it.o) ? fmtHM(it.at) : "終日"}</span>
                  <span className="text-ink/80 truncate">{it.o.account?.name}</span>
                </Link>
              ))}
              {list.length === 0 && <span className="text-[10px] text-ink/25">—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ cursor, byDay, onPickDay }: { cursor: Date; byDay: Map<string, { o: OppView; at: Date }[]>; onPickDay: (d: Date) => void }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = ymd(new Date());
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-black/[0.06] bg-mist-soft/40">
        {WD.map((w, i) => <div key={w} className={cn("px-2 py-1.5 text-[11px] font-semibold", i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-ink/55")}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const list = byDay.get(ymd(d)) ?? [];
          return (
            <button key={ymd(d)} onClick={() => onPickDay(d)} className={cn("min-h-[92px] border-b border-r border-black/[0.04] p-1 text-left align-top hover:bg-mist-soft/50", !inMonth && "bg-black/[0.015]")}>
              <div className={cn("text-[11px] tabular-nums mb-0.5", ymd(d) === today ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-primary text-white" : inMonth ? "text-ink/60" : "text-ink/25")}>{d.getDate()}</div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((it) => (
                  <div key={it.o.id} className="rounded bg-teal-light/60 px-1 py-0.5 text-[10px] truncate">
                    <span className="text-teal-deep tabular-nums mr-0.5">{hasTime(it.o) ? fmtHM(it.at) : "終"}</span>{it.o.account?.name}
                  </div>
                ))}
                {list.length > 3 && <div className="text-[10px] text-ink/40">＋{list.length - 3}件</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition-colors", active ? "bg-teal-primary text-white" : "text-ink/55 hover:text-ink")}>
      {icon}{label}
    </button>
  );
}
