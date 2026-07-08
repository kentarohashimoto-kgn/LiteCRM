"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, List, CalendarDays, Columns3, Square, Check } from "lucide-react";
import type { CalItem } from "@/lib/data/calendar";
import { setAppointmentAtAction } from "@/server/actions/opportunities";
import { YomiBadge } from "@/components/ui/badges";
import { Avatar } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Option { id: string; name: string; }
type View = "list" | "month" | "week" | "day";
type KindFilter = "all" | "appt";
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
const dateFromYmd = (s: string) => { const [y, m, dd] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, dd); };

function eventDate(it: CalItem): Date {
  if (it.timed && it.at) return new Date(it.at);
  return dateFromYmd(it.on_date);
}
function toLocalInput(it: CalItem): string {
  const d = eventDate(it);
  if (!it.timed) d.setHours(10, 0, 0, 0);
  return `${ymd(d)}T${fmtHM(d)}`;
}
function ownerColor(it: CalItem): string { return it.owner_color ?? "#008C8C"; }
function ownerUser(it: CalItem) {
  return it.owner_user_id ? { id: it.owner_user_id, name: it.owner_name ?? "—", avatarColor: it.owner_color ?? "#008C8C" } : undefined;
}
function oppHref(it: CalItem): string {
  return it.meeting_id ? `/app/opportunities/${it.opportunity_id}/meetings/${it.meeting_id}` : `/app/opportunities/${it.opportunity_id}`;
}

interface Appt { item: CalItem; at: Date; timed: boolean; key: string; }

export interface BookingLink { id: string; label: string; url: string; }

export function AppointmentCalendarPro({ items, owners, bookingLinks = [] }: { items: CalItem[]; owners: Option[]; bookingLinks?: BookingLink[] }) {
  const [rows, setRows] = useState<CalItem[]>(items);
  useEffect(() => setRows(items), [items]);
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<Date>(startOfDay(new Date()));
  const [ownerFilter, setOwnerFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const appts: Appt[] = useMemo(() => {
    return rows
      .filter((it) => kindFilter === "all" || it.kind === "appt")
      .filter((it) => !ownerFilter || it.owner_user_id === ownerFilter)
      .map((it, i) => ({ item: it, at: eventDate(it), timed: it.timed, key: it.meeting_id ?? `${it.opportunity_id}:${it.kind}:${it.on_date}:${i}` }))
      .sort((a, b) => +a.at - +b.at);
  }, [rows, ownerFilter, kindFilter]);

  const byDay = useMemo(() => {
    const m = new Map<string, Appt[]>();
    for (const a of appts) { const k = a.item.on_date; if (!m.has(k)) m.set(k, []); m.get(k)!.push(a); }
    return m;
  }, [appts]);

  const counts = useMemo(() => {
    let appt = 0, done = 0;
    for (const a of appts) { if (a.item.kind === "appt") appt++; else done++; }
    return { appt, done };
  }, [appts]);

  const legend = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const a of appts) if (a.item.owner_user_id) m.set(a.item.owner_user_id, { name: a.item.owner_name ?? "—", color: ownerColor(a.item) });
    return Array.from(m.values());
  }, [appts]);

  // 時刻設定はアポ(予定)のみ。DBはappointment_atを更新し、楽観的にローカルも反映。
  async function setTime(it: CalItem, localValue: string) {
    if (it.kind !== "appt") return;
    const iso = localValue ? new Date(localValue).toISOString() : null;
    setRows((prev) => prev.map((x) => (x.opportunity_id === it.opportunity_id && x.kind === "appt" ? { ...x, at: iso, timed: !!iso } : x)));
    await setAppointmentAtAction({ id: it.opportunity_id, iso });
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
        {/* 表示フィルタ: すべて(アポ＋アポ済) / アポのみ。既定はすべて */}
        <div className="ml-auto inline-flex rounded-xl border border-black/10 bg-white p-0.5 text-xs">
          <button type="button" onClick={() => setKindFilter("all")} className={cn("rounded-lg px-2.5 py-1 font-medium", kindFilter === "all" ? "bg-teal-primary text-white" : "text-ink/55")}>すべて</button>
          <button type="button" onClick={() => setKindFilter("appt")} className={cn("rounded-lg px-2.5 py-1 font-medium", kindFilter === "appt" ? "bg-teal-primary text-white" : "text-ink/55")}>アポのみ</button>
        </div>
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
          <option value="">担当：すべて</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <span className="text-xs text-ink/45">アポ {counts.appt}{kindFilter === "all" ? ` ・ アポ済 ${counts.done}` : ""} 件</span>
      </div>

      {/* 凡例(種別 ＋ 担当↔色) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <span className="inline-flex items-center gap-1 text-[11px] text-ink/70"><span className="w-3 h-3 rounded-sm bg-teal-primary" />アポ(予定)</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-ink/70"><span className="w-3 h-3 rounded-sm border border-dashed border-ink/40 bg-white inline-flex items-center justify-center"><Check size={8} className="text-ink/50" /></span>アポ済(実施)</span>
        {legend.length > 0 && <span className="text-[11px] text-ink/30 mx-1">|</span>}
        {legend.map((l) => (
          <span key={l.name} className="inline-flex items-center gap-1 text-[11px] text-ink/70">
            <span className="w-3 h-3 rounded-sm" style={{ background: l.color }} />{l.name}
          </span>
        ))}
      </div>

      {view === "list" && <ListView byDay={byDay} onSetTime={setTime} />}
      {view === "month" && <MonthView cursor={cursor} byDay={byDay} onPickDay={(d) => { setCursor(d); setView("day"); }} />}
      {view === "week" && <TimeGrid days={Array.from({ length: 7 }, (_, i) => addDays(wkStart, i))} byDay={byDay} onSetTime={setTime} />}
      {view === "day" && <TimeGrid days={[cursor]} byDay={byDay} onSetTime={setTime} wide />}

      <p className="text-[11px] text-ink/40">※ <b>アポ</b>=ヨミ「4.アポ」の未実施予定（時刻設定可）。<b>アポ済</b>=実施済みの商談（初回商談日・追加の商談日）で、点線枠＋✓で表示。「アポのみ」で予定だけに絞り込めます。</p>

      {/* 各担当の空き時間(予約URL) */}
      {bookingLinks.length > 0 && (
        <div className="card card-pad">
          <div className="text-xs font-semibold text-ink/60 mb-2">各担当の空き時間（予約）</div>
          <div className="flex flex-wrap gap-2">
            {bookingLinks.map((b) => (
              <a key={b.id} href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-teal-primary/30 bg-teal-light/30 px-2.5 py-1.5 text-xs font-medium text-teal-deep hover:bg-teal-light">
                {b.label} <span className="text-teal-deep/50">↗</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 週/日の時間グリッド。時刻ありは時間軸に配置、終日は上部の帯に全件表示。 */
function TimeGrid({ days, byDay, onSetTime }: { days: Date[]; byDay: Map<string, Appt[]>; onSetTime: (it: CalItem, v: string) => void; wide?: boolean }) {
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
              {allday.map((a) => <ApptChip key={a.key} a={a} onSetTime={onSetTime} />)}
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
                const done = a.item.kind === "done";
                return (
                  <Link
                    key={a.key}
                    href={oppHref(a.item)}
                    className={cn("absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 overflow-hidden shadow-sm", done ? "text-ink border border-dashed" : "text-white")}
                    style={done
                      ? { top, minHeight: PX_PER_HOUR - 4, background: ownerColor(a.item) + "22", borderColor: ownerColor(a.item) }
                      : { top, minHeight: PX_PER_HOUR - 4, background: ownerColor(a.item) }}
                    title={`${fmtHM(a.at)} ${a.item.account_name} / ${a.item.owner_name ?? ""} / ${a.item.title}`}
                  >
                    <div className={cn("text-[10px] font-semibold tabular-nums leading-tight flex items-center gap-0.5", done && "text-ink/70")}>
                      {done && <Check size={9} />}{fmtHM(a.at)} <span className="opacity-90">{a.item.title}</span>
                    </div>
                    <div className="text-[11px] font-medium truncate leading-tight">{a.item.account_name}</div>
                    <div className={cn("text-[9px] truncate", done ? "text-ink/45" : "opacity-90")}>{a.item.owner_name}</div>
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

function ApptChip({ a, onSetTime }: { a: Appt; onSetTime: (it: CalItem, v: string) => void }) {
  const done = a.item.kind === "done";
  const user = ownerUser(a.item);
  return (
    <div className={cn("rounded-md px-1.5 py-1 text-[11px]", done && "border border-dashed")}
      style={done
        ? { background: ownerColor(a.item) + "14", borderColor: ownerColor(a.item) + "88" }
        : { background: ownerColor(a.item) + "22", borderLeft: `3px solid ${ownerColor(a.item)}` }}>
      <div className="flex items-center gap-1">
        {done && <Check size={11} className="text-ink/45 shrink-0" />}
        {user && <Avatar user={user as never} size={14} />}
        <Link href={oppHref(a.item)} className="font-medium text-ink truncate hover:text-teal-deep flex-1">{a.item.account_name}</Link>
        <span className="text-[9px] text-ink/50 shrink-0">{a.item.title}</span>
      </div>
      {a.item.kind === "appt" ? (
        <div className="mt-0.5 flex items-center gap-1">
          <input type="datetime-local" defaultValue={toLocalInput(a.item)} onChange={(e) => onSetTime(a.item, e.target.value)} className="rounded border border-black/10 bg-white px-1 py-0.5 text-[10px] outline-none" title="開始時刻を設定" />
        </div>
      ) : null}
    </div>
  );
}

function ListView({ byDay, onSetTime }: { byDay: Map<string, Appt[]>; onSetTime: (it: CalItem, v: string) => void }) {
  const days = Array.from(byDay.keys()).sort();
  const today = ymd(new Date());
  const upcoming = days.filter((d) => d >= today);
  const shown = upcoming.length ? upcoming : days;
  if (shown.length === 0) return <div className="card card-pad text-sm text-ink/40 text-center py-8">表示する予定・実施履歴はありません</div>;
  return (
    <div className="card divide-y divide-black/[0.05]">
      {shown.map((d) => {
        const dt = new Date(d + "T00:00:00");
        const list = byDay.get(d)!;
        return (
          <div key={d} className="px-4 py-2">
            <div className="text-xs font-semibold text-ink/60 mb-1">{dt.getMonth() + 1}/{dt.getDate()}（{WD[dt.getDay()]}）<span className="text-ink/35 ml-1">{list.length}件</span></div>
            <div className="divide-y divide-black/[0.03]">
              {list.map((a) => {
                const done = a.item.kind === "done";
                const user = ownerUser(a.item);
                return (
                  <div key={a.key} className="flex items-center gap-2 py-1.5">
                    <span className={cn("text-xs tabular-nums shrink-0 w-14", a.timed ? "text-teal-deep font-medium" : "text-ink/40")}>{a.timed ? fmtHM(a.at) : "終日"}</span>
                    <span className={cn("pill text-[10px] shrink-0 w-12 justify-center", done ? "bg-mist-soft text-ink/50" : "bg-teal-light text-teal-deep")}>{done ? "アポ済" : "アポ"}</span>
                    {user && <Avatar user={user as never} size={20} />}
                    <span className="text-[10px] text-ink/50 shrink-0 w-12 truncate">{a.item.owner_name}</span>
                    <span className="pill bg-mist-soft text-ink/55 text-[10px] shrink-0">{a.item.title}</span>
                    <Link href={oppHref(a.item)} className="min-w-0 flex-1">
                      <span className="block text-sm text-ink truncate hover:text-teal-deep">{a.item.account_name}</span>
                      <span className="block text-[11px] text-ink/45 truncate">{a.item.opp_name}</span>
                    </Link>
                    <YomiBadge yomi={a.item.yomi} />
                    {a.item.kind === "appt" && (
                      <input type="datetime-local" defaultValue={toLocalInput(a.item)} onChange={(e) => onSetTime(a.item, e.target.value)} className="rounded-lg border border-black/10 bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-teal-primary shrink-0" title="開始時刻を設定" />
                    )}
                  </div>
                );
              })}
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
                {list.slice(0, 4).map((a) => {
                  const done = a.item.kind === "done";
                  return (
                    <div key={a.key} className={cn("rounded px-1 py-0.5 text-[10px] truncate flex items-center gap-0.5", done ? "text-ink border border-dashed" : "text-white")}
                      style={done ? { background: ownerColor(a.item) + "1c", borderColor: ownerColor(a.item) + "77" } : { background: ownerColor(a.item) }}>
                      {done ? <Check size={8} className="shrink-0 text-ink/50" /> : <span className="tabular-nums mr-0.5">{a.timed ? fmtHM(a.at) : "終"}</span>}
                      <span className="truncate">{a.item.account_name}</span>
                    </div>
                  );
                })}
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
