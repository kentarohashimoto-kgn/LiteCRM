"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const DAY_START = 8; // 8:00
const DAY_END = 21; // 21:00
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
const PX_PER_HOUR = 44;

// --- date helpers (local) ---
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(startOfDay(d), -d.getDay());
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtHM = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function apptDate(o: OppView): Date | null {
  if (o.appointment_at) return new Date(o.appointment_at);
  if (o.first_meeting_date) { const [y, m, dd] = o.first_meeting_date.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, dd); }
  return null;
}
const hasTime = (o: OppView) => !!o.appointment_at;
function toLocalInput(o: OppView): string {
  const d = apptDate(o);
  if (!d) return "";
  if (!o.appointment_at) d.setHours(10, 0, 0, 0);
  return `${ymd(d)}T${fmtHM(d)}`;
}
/** 商談回数ラベル: 実施済み0=初回、それ以外は次の回。 */
function meetingLabel(o: OppView): string {
  const n = o.meeting_count ?? 0;
  return n <= 0 ? "初回商談" : `${n + 1}回目`;
}
function ownerColor(o: OppView): string { return o.owner?.avatarColor ?? "#008C8C"; }

interface Appt { o: OppView; at: Date; timed: boolean; }

export function AppointmentCalendarPro({ opps, owners }: { opps: OppView[]; owners: Option[] }) {
  const [items, setItems] = useState<OppView[]>(opps);
  useEffect(() => setItems(opps), [opps]);
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<Date>(startOfDay(new Date()));
  const [ownerFilter, setOwnerFilter] = useState("");

  const appts: Appt[] = useMemo(() => {
    return items
      .filter((o) => o.yomi === YOMI_APPOINTMENT && apptDate(o))
      .filter((o) => !ownerFilter || o.owner_user_id === ownerFilter)
      .map((o) => ({ o, at: apptDate(o)!, timed: hasTime(o) }))
      .sort((a, b) => +a.at - +b.at);
  }, [items, ownerFilter]);

  const byDay = useMemo(() => {
    const m = new Map<string, Appt[]>();
    for (const a of appts) { const k = ymd(a.at); if (!m.has(k)) m.set(k, []); m.get(k)!.push(a); }
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
  const wkStart = startOfWeek(cursor);
  const title = view === "month"
    ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
    : view === "week"
      ? `${wkStart.getMonth() + 1}/${wkStart.getDate()} 〜 ${addDays(wkStart, 6).getMonth() + 1}/${addDays(wkStart, 6).getDate()}`
      : `${cursor.getFullYear()}年${cursor.getMonth() + 1}月${cursor.getDate()}日(${WD[cursor.getDay()]})`;

  return (
    <div className="space-y-3">
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
      {view === "week" && <TimeGrid days={Array.from({ length: 7 }, (_, i) => addDays(wkStart, i))} byDay={byDay} onSetTime={setTime} />}
      {view === "day" && <TimeGrid days={[cursor]} byDay={byDay} onSetTime={setTime} wide />}

      <p className="text-[11px] text-ink/40">※ アポ=ヨミ「4.アポ」の案件。時刻を設定した案件は時間軸上に配置、未設定は各日の「終日」帯に表示（全件表示）。バーの左に担当・回数を表示します。</p>
    </div>
  );
}

/** 週/日の時間グリッド。時刻ありは時間軸に配置、終日は上部の帯に全件表示。 */
function TimeGrid({ days, byDay, onSetTime, wide = false }: { days: Date[]; byDay: Map<string, Appt[]>; onSetTime: (o: OppView, v: string) => void; wide?: boolean }) {
  const gridH = HOURS.length * PX_PER_HOUR;
  const today = ymd(new Date());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div className="card overflow-hidden">
      {/* 日付ヘッダ */}
      <div className="flex border-b border-black/[0.06] bg-mist-soft/40">
        <div className="w-12 shrink-0" />
        {days.map((d) => (
          <div key={ymd(d)} className={cn("flex-1 px-2 py-1.5 text-center border-l border-black/[0.05]", ymd(d) === today && "bg-teal-light/40")}>
            <span className={cn("text-xs font-semibold", d.getDay() === 0 ? "text-rose-500" : d.getDay() === 6 ? "text-blue-500" : "text-ink/70")}>{d.getMonth() + 1}/{d.getDate()}（{WD[d.getDay()]}）</span>
            <span className="ml-1 text-[10px] text-ink/40">{(byDay.get(ymd(d)) ?? []).length}件</span>
          </div>
        ))}
      </div>
      {/* 終日帯(時刻未設定を漏れなく表示) */}
      <div className="flex border-b border-black/[0.08] bg-amber-50/40">
        <div className="w-12 shrink-0 text-[10px] text-ink/40 px-1 py-1 text-right">終日</div>
        {days.map((d) => {
          const allday = (byDay.get(ymd(d)) ?? []).filter((a) => !a.timed);
          return (
            <div key={ymd(d)} className="flex-1 border-l border-black/[0.05] p-1 space-y-1 min-h-[28px]">
              {allday.map((a) => <ApptChip key={a.o.id} a={a} onSetTime={onSetTime} />)}
            </div>
          );
        })}
      </div>
      {/* 時間軸 */}
      <div ref={scrollRef} className="flex max-h-[560px] overflow-y-auto">
        <div className="w-12 shrink-0 relative" style={{ height: gridH }}>
          {HOURS.map((h, i) => (
            <div key={h} className="absolute right-1 text-[10px] text-ink/40" style={{ top: i * PX_PER_HOUR - 5 }}>{h}:00</div>
          ))}
        </div>
        {days.map((d) => {
          const timed = (byDay.get(ymd(d)) ?? []).filter((a) => a.timed);
          return (
            <div key={ymd(d)} className="flex-1 relative border-l border-black/[0.05]" style={{ height: gridH }}>
              {HOURS.map((h, i) => <div key={h} className="absolute left-0 right-0 border-t border-black/[0.04]" style={{ top: i * PX_PER_HOUR }} />)}
              {timed.map((a) => {
                const minutes = (a.at.getHours() - DAY_START) * 60 + a.at.getMinutes();
                const top = Math.max(0, (minutes / 60) * PX_PER_HOUR);
                return (
                  <Link
                    key={a.o.id}
                    href={`/app/opportunities/${a.o.id}`}
                    className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-white overflow-hidden shadow-sm"
                    style={{ top, minHeight: PX_PER_HOUR - 4, background: ownerColor(a.o) }}
                    title={`${fmtHM(a.at)} ${a.o.account?.name} / ${a.o.owner?.name ?? ""} / ${meetingLabel(a.o)}`}
                  >
                    <div className="text-[10px] font-semibold tabular-nums leading-tight">{fmtHM(a.at)} <span className="opacity-90">{meetingLabel(a.o)}</span></div>
                    <div className="text-[11px] font-medium truncate leading-tight">{a.o.account?.name}</div>
                    <div className="text-[9px] opacity-90 truncate">{a.o.owner?.name}</div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ApptChip({ a, onSetTime }: { a: Appt; onSetTime: (o: OppView, v: string) => void }) {
  return (
    <div className="rounded-md px-1.5 py-1 text-[11px]" style={{ background: ownerColor(a.o) + "22", borderLeft: `3px solid ${ownerColor(a.o)}` }}>
      <div className="flex items-center gap-1">
        {a.o.owner && <Avatar user={a.o.owner} size={14} />}
        <Link href={`/app/opportunities/${a.o.id}`} className="font-medium text-ink truncate hover:text-teal-deep flex-1">{a.o.account?.name}</Link>
        <span className="text-[9px] text-ink/50 shrink-0">{meetingLabel(a.o)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <input type="datetime-local" defaultValue={toLocalInput(a.o)} onChange={(e) => onSetTime(a.o, e.target.value)} className="rounded border border-black/10 bg-white px-1 py-0.5 text-[10px] outline-none" title="開始時刻を設定" />
      </div>
    </div>
  );
}

function ListView({ byDay, onSetTime }: { byDay: Map<string, Appt[]>; onSetTime: (o: OppView, v: string) => void }) {
  const days = Array.from(byDay.keys()).sort();
  const today = ymd(new Date());
  const upcoming = days.filter((d) => d >= today);
  const shown = upcoming.length ? upcoming : days;
  if (shown.length === 0) return <div className="card card-pad text-sm text-ink/40 text-center py-8">アポの予定はありません</div>;
  return (
    <div className="card divide-y divide-black/[0.05]">
      {shown.map((d) => {
        const dt = new Date(d + "T00:00:00");
        const list = byDay.get(d)!;
        return (
          <div key={d} className="px-4 py-2">
            <div className="text-xs font-semibold text-ink/60 mb-1">{dt.getMonth() + 1}/{dt.getDate()}（{WD[dt.getDay()]}）<span className="text-ink/35 ml-1">{list.length}件</span></div>
            <div className="divide-y divide-black/[0.03]">
              {list.map((a) => (
                <div key={a.o.id} className="flex items-center gap-2 py-1.5">
                  <span className={cn("text-xs tabular-nums shrink-0 w-14", a.timed ? "text-teal-deep font-medium" : "text-ink/40")}>{a.timed ? fmtHM(a.at) : "終日"}</span>
                  {a.o.owner && <Avatar user={a.o.owner} size={20} />}
                  <span className="text-[10px] text-ink/50 shrink-0 w-12">{a.o.owner?.name}</span>
                  <span className="pill bg-mist-soft text-ink/55 text-[10px] shrink-0">{meetingLabel(a.o)}</span>
                  <Link href={`/app/opportunities/${a.o.id}`} className="min-w-0 flex-1">
                    <span className="block text-sm text-ink truncate hover:text-teal-deep">{a.o.account?.name}</span>
                    <span className="block text-[11px] text-ink/45 truncate">{a.o.next_action_text ?? a.o.name}</span>
                  </Link>
                  <YomiBadge yomi={a.o.yomi} />
                  <input type="datetime-local" defaultValue={toLocalInput(a.o)} onChange={(e) => onSetTime(a.o, e.target.value)} className="rounded-lg border border-black/10 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-teal-primary shrink-0" title="開始時刻を設定" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ cursor, byDay, onPickDay }: { cursor: Date; byDay: Map<string, Appt[]>; onPickDay: (d: Date) => void }) {
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
            <button key={ymd(d)} onClick={() => onPickDay(d)} className={cn("min-h-[96px] border-b border-r border-black/[0.04] p-1 text-left align-top hover:bg-mist-soft/50", !inMonth && "bg-black/[0.015]")}>
              <div className={cn("text-[11px] tabular-nums mb-0.5", ymd(d) === today ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-primary text-white" : inMonth ? "text-ink/60" : "text-ink/25")}>{d.getDate()}</div>
              <div className="space-y-0.5">
                {list.slice(0, 4).map((a) => (
                  <div key={a.o.id} className="rounded px-1 py-0.5 text-[10px] truncate text-white" style={{ background: ownerColor(a.o) }}>
                    <span className="tabular-nums mr-0.5">{a.timed ? fmtHM(a.at) : "終"}</span>{a.o.account?.name}
                  </div>
                ))}
                {list.length > 4 && <div className="text-[10px] text-teal-deep font-medium">＋{list.length - 4}件（クリックで表示）</div>}
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
