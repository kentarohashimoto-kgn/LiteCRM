"use client";

import { useMemo, useRef, useState } from "react";
import { cn, initials } from "@/lib/utils";
import { NO_SECTION, sortTasks, type DepVM, type SectionVM, type TaskVM, type UserVM } from "./vm";
import { TaskCheckbox } from "./task-checkbox";
import type { TaskInput } from "@/server/actions/tasks";

/* ---------------------------------------------------------------------
 * F-201 タイムライン（ガント）ビュー。
 *  - 行 = セクション見出し + タスク（リストと同じ並び）。列 = 日付。
 *  - バーのドラッグで期間移動、両端ドラッグで開始日/期日を変更。
 *  - バー右端の◯を別のバーへドラッグすると依存（先行→後続）を追加。
 *  - マイルストーンは◆の一点表示。日程未設定はグリッドをクリックして設定。
 * ------------------------------------------------------------------- */

export type TimelineZoom = "day" | "week" | "month" | "quarter";

const PPD: Record<TimelineZoom, number> = { day: 44, week: 16, month: 5.5, quarter: 2.5 };
const PAD_DAYS: Record<TimelineZoom, number> = { day: 7, week: 14, month: 30, quarter: 45 };
const LEFT_W = 248;
const ROW_H = 36;
const SECTION_H = 30;
const HEADER_H = 46;

interface Props {
  tasks: TaskVM[];
  sections: SectionVM[];
  deps: DepVM[];
  today: string;
  usersById: Map<string, UserVM>;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
  onPatch: (id: string, p: Partial<TaskInput>) => void;
  onAddDep: (predecessorId: string, successorId: string) => void;
  onRemoveDep: (id: string) => void;
}

/* ---------- 日付ユーティリティ（"YYYY-MM-DD" ローカル基準） ---------- */
function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setDate(x.getDate() + n);
  return iso(x);
}
function diffDays(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}

/** タスクの表示上の期間（開始・終了とも "YYYY-MM-DD"）。両方nullなら未日程。 */
function span(t: TaskVM): { s: string; e: string } | null {
  const s = t.start_date ?? t.due_date ?? null;
  const e = t.due_date ?? t.start_date ?? null;
  if (!s || !e) return null;
  return s <= e ? { s, e } : { s: e, e: s };
}

type Row =
  | { kind: "section"; key: string; name: string }
  | { kind: "task"; task: TaskVM };

interface Drag {
  id: string;
  mode: "move" | "resize-l" | "resize-r";
  originX: number;
  days: number;
  moved: boolean;
}

interface Connect {
  fromId: string;
  x: number;
  y: number;
  toX: number;
  toY: number;
}

export function TimelineView(p: Props) {
  const [zoom, setZoom] = useState<TimelineZoom>("week");
  const ppd = PPD[zoom];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [connect, setConnect] = useState<Connect | null>(null);

  /* ---- 行の構築（セクション見出し＋タスク。リストビューと同じ並び） ---- */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const push = (key: string, name: string, ts: TaskVM[]) => {
      if (ts.length === 0) return;
      out.push({ kind: "section", key, name });
      for (const t of ts.slice().sort(sortTasks)) out.push({ kind: "task", task: t });
    };
    const orphan = p.tasks.filter((t) => !t.section_id);
    if (orphan.length > 0 || p.sections.length === 0) push(NO_SECTION, "未分類", orphan);
    for (const s of p.sections) push(s.id, s.name, p.tasks.filter((t) => t.section_id === s.id));
    return out;
  }, [p.tasks, p.sections]);

  /* ---- 日付レンジ（全タスク＋今日を含む） ---- */
  const { rangeStart, totalDays } = useMemo(() => {
    let min = p.today;
    let max = p.today;
    for (const t of p.tasks) {
      const sp = span(t);
      if (!sp) continue;
      if (sp.s < min) min = sp.s;
      if (sp.e > max) max = sp.e;
    }
    const pad = PAD_DAYS[zoom];
    const start = addDays(min, -pad);
    const end = addDays(max, pad);
    return { rangeStart: start, totalDays: Math.max(diffDays(start, end) + 1, 30) };
  }, [p.tasks, p.today, zoom]);

  const gridW = totalDays * ppd;
  const dayX = (d: string) => diffDays(rangeStart, d) * ppd;
  const xDay = (x: number) => addDays(rangeStart, Math.max(0, Math.min(totalDays - 1, Math.floor(x / ppd))));

  /* ---- 行のY座標とタスク座標 ---- */
  const { rowsH, taskPos } = useMemo(() => {
    let y = 0;
    const pos = new Map<string, { y: number }>();
    for (const r of rows) {
      if (r.kind === "section") y += SECTION_H;
      else {
        pos.set(r.task.id, { y });
        y += ROW_H;
      }
    }
    return { rowsH: y, taskPos: pos };
  }, [rows]);

  const tasksById = useMemo(() => new Map(p.tasks.map((t) => [t.id, t])), [p.tasks]);

  /* ---- ドラッグ中の日数シフトを反映した期間 ---- */
  const shiftedSpan = (t: TaskVM): { s: string; e: string } | null => {
    const sp = span(t);
    if (!sp) return null;
    if (!drag || drag.id !== t.id || drag.days === 0) return sp;
    if (drag.mode === "move") return { s: addDays(sp.s, drag.days), e: addDays(sp.e, drag.days) };
    if (drag.mode === "resize-l") {
      const ns = addDays(sp.s, drag.days);
      return { s: ns <= sp.e ? ns : sp.e, e: sp.e };
    }
    const ne = addDays(sp.e, drag.days);
    return { s: sp.s, e: ne >= sp.s ? ne : sp.s };
  };

  /* ---- 依存の矢印座標＋日程矛盾（後続の開始が先行の終了より前） ---- */
  const depLines = useMemo(() => {
    return p.deps.flatMap((d) => {
      const pred = tasksById.get(d.predecessor_task_id);
      const succ = tasksById.get(d.successor_task_id);
      if (!pred || !succ) return [];
      const ps = span(pred);
      const ss = span(succ);
      const py = taskPos.get(pred.id)?.y;
      const sy = taskPos.get(succ.id)?.y;
      if (!ps || !ss || py === undefined || sy === undefined) return [];
      const warn = pred.status !== "done" && succ.status !== "done" && ss.s < ps.e;
      return [
        {
          id: d.id,
          x1: dayX(ps.e) + ppd,
          y1: py + ROW_H / 2,
          x2: dayX(ss.s),
          y2: sy + ROW_H / 2,
          warn,
        },
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.deps, tasksById, taskPos, ppd, rangeStart]);

  const warnTaskIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of depLines) if (l.warn) { const dep = p.deps.find((d) => d.id === l.id); if (dep) s.add(dep.successor_task_id); }
    return s;
  }, [depLines, p.deps]);

  /* ---- バードラッグ ---- */
  const startDrag = (e: React.PointerEvent, id: string, mode: Drag["mode"]) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ id, mode, originX: e.clientX, days: 0, moved: false });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const days = Math.round((e.clientX - drag.originX) / ppd);
    setDrag((d) => (d ? { ...d, days, moved: d.moved || Math.abs(e.clientX - d.originX) > 3 } : d));
  };
  const endDrag = () => {
    if (!drag) return;
    const t = tasksById.get(drag.id);
    const sp = t ? shiftedSpan(t) : null;
    if (t && sp && drag.days !== 0) {
      if (t.is_milestone) {
        p.onPatch(t.id, { due_date: sp.e });
      } else {
        p.onPatch(t.id, {
          start_date: t.start_date != null || drag.mode === "resize-l" ? sp.s : null,
          due_date: sp.e,
        });
      }
    } else if (t && !drag.moved) {
      p.onOpen(t.id);
    }
    setDrag(null);
  };

  /* ---- 依存の接続ドラッグ（右端◯ → 相手のバー/行へ） ---- */
  const gridElRef = useRef<HTMLDivElement>(null);
  const toGridXY = (e: React.PointerEvent) => {
    const r = gridElRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };
  const startConnect = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const { x, y } = toGridXY(e);
    setConnect({ fromId: id, x, y, toX: x, toY: y });
  };
  const moveConnect = (e: React.PointerEvent) => {
    if (!connect) return;
    const { x, y } = toGridXY(e);
    setConnect((c) => (c ? { ...c, toX: x, toY: y } : c));
  };
  const endConnect = (e: React.PointerEvent) => {
    if (!connect) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-task-row]");
    const targetId = el?.getAttribute("data-task-row");
    if (targetId && targetId !== connect.fromId) p.onAddDep(connect.fromId, targetId);
    setConnect(null);
  };

  /* ---- ヘッダー（月＋日/週の目盛り） ---- */
  const months = useMemo(() => {
    const out: { label: string; x: number; w: number }[] = [];
    let cur = parse(rangeStart);
    cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const end = parse(addDays(rangeStart, totalDays - 1));
    while (cur <= end) {
      const mStart = iso(cur);
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const from = Math.max(0, diffDays(rangeStart, mStart));
      const to = Math.min(totalDays, diffDays(rangeStart, iso(next)));
      out.push({ label: `${cur.getFullYear()}年${cur.getMonth() + 1}月`, x: from * ppd, w: (to - from) * ppd });
      cur = next;
    }
    return out;
  }, [rangeStart, totalDays, ppd]);

  const ticks = useMemo(() => {
    const out: { label: string; x: number; weekend: boolean }[] = [];
    if (zoom === "month" || zoom === "quarter") return out;
    for (let i = 0; i < totalDays; i++) {
      const d = parse(addDays(rangeStart, i));
      const dow = d.getDay();
      if (zoom === "day") out.push({ label: `${d.getDate()}`, x: i * ppd, weekend: dow === 0 || dow === 6 });
      else if (dow === 1) out.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, x: i * ppd, weekend: false });
    }
    return out;
  }, [zoom, rangeStart, totalDays, ppd]);

  /** 週末の帯（日/週ズームのみ）。 */
  const weekends = useMemo(() => {
    if (ppd < 10) return [] as { x: number; w: number }[];
    const out: { x: number; w: number }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const dow = parse(addDays(rangeStart, i)).getDay();
      if (dow === 6) out.push({ x: i * ppd, w: ppd * 2 });
    }
    return out;
  }, [ppd, rangeStart, totalDays]);

  const todayX = dayX(p.today);
  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, LEFT_W + todayX - el.clientWidth / 3);
  };

  return (
    <div className="card overflow-hidden">
      {/* ツールバー */}
      <div className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-mist-soft p-0.5">
          {(
            [
              ["day", "日"],
              ["week", "週"],
              ["month", "月"],
              ["quarter", "四半期"],
            ] as [TimelineZoom, string][]
          ).map(([z, label]) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold",
                zoom === z ? "bg-white text-teal-deep shadow-sm" : "text-ink/50 hover:text-ink/80",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={scrollToToday} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink/60 hover:bg-mist-soft">
          今日へ
        </button>
        <span className="ml-auto text-[11px] text-ink/40">バー右端の◯を別のタスクへドラッグすると依存関係を追加できます</span>
      </div>

      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
        <div style={{ width: LEFT_W + gridW, minWidth: "100%" }}>
          {/* ヘッダー */}
          <div className="flex sticky top-0 z-30" style={{ height: HEADER_H }}>
            <div className="sticky left-0 z-10 shrink-0 border-b border-r border-black/[0.08] bg-white" style={{ width: LEFT_W }} />
            <div className="relative border-b border-black/[0.08] bg-white" style={{ width: gridW, height: HEADER_H }}>
              {months.map((m) => (
                <div key={m.label + m.x} className="absolute top-0 h-[22px] border-l border-black/[0.06] pl-1.5 text-[11px] font-semibold text-ink/60 whitespace-nowrap overflow-hidden" style={{ left: m.x, width: m.w }}>
                  {m.label}
                </div>
              ))}
              {ticks.map((t) => (
                <div key={t.x} className={cn("absolute bottom-0 h-[24px] pl-1 text-[10px] tabular-nums text-ink/40", t.weekend && "text-rose-400/70")} style={{ left: t.x }}>
                  {t.label}
                </div>
              ))}
            </div>
          </div>

          {/* 本体 */}
          <div className="flex">
            {/* 左ペイン: タスクリスト */}
            <div className="sticky left-0 z-20 shrink-0 border-r border-black/[0.08] bg-white" style={{ width: LEFT_W }}>
              {rows.map((r) =>
                r.kind === "section" ? (
                  <div key={`s-${r.key}`} className="flex items-center gap-1.5 bg-mist-soft/60 px-3 text-xs font-bold text-ink/70" style={{ height: SECTION_H }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-primary" />
                    {r.name}
                  </div>
                ) : (
                  <div key={r.task.id} className="flex items-center gap-2 border-b border-black/[0.03] px-3" style={{ height: ROW_H }}>
                    <TaskCheckbox done={r.task.status === "done"} onToggle={(next) => p.onToggle(r.task.id, next)} size={16} />
                    {r.task.is_milestone && <span className="inline-block h-2 w-2 rotate-45 bg-amber-500 shrink-0" title="マイルストーン" />}
                    <button
                      type="button"
                      onClick={() => p.onOpen(r.task.id)}
                      className={cn("min-w-0 flex-1 truncate text-left text-[12.5px]", r.task.status === "done" ? "line-through text-ink/35" : "text-ink")}
                      title={r.task.title}
                    >
                      {r.task.title}
                    </button>
                    <MiniAvatar user={p.usersById.get(r.task.assigned_to ?? "")} />
                  </div>
                ),
              )}
            </div>

            {/* 右ペイン: グリッド＋バー */}
            <div ref={gridElRef} className="relative" style={{ width: gridW, height: rowsH }}>
              {/* 週末帯 */}
              {weekends.map((w) => (
                <div key={w.x} className="absolute top-0 bottom-0 bg-mist-soft/40" style={{ left: w.x, width: w.w }} />
              ))}
              {/* 月境界線 */}
              {months.map((m) => (
                <div key={`ml-${m.x}`} className="absolute top-0 bottom-0 border-l border-black/[0.05]" style={{ left: m.x }} />
              ))}
              {/* 今日線 */}
              <div className="absolute top-0 bottom-0 w-[2px] bg-accent-orange/70 z-10 pointer-events-none" style={{ left: todayX + ppd / 2 }} />

              {/* 行（背景＋バー） */}
              {(() => {
                let y = 0;
                return rows.map((r) => {
                  if (r.kind === "section") {
                    const el = <div key={`sg-${r.key}`} className="absolute left-0 right-0 bg-mist-soft/60" style={{ top: y, height: SECTION_H }} />;
                    y += SECTION_H;
                    return el;
                  }
                  const t = r.task;
                  const top = y;
                  y += ROW_H;
                  const sp = shiftedSpan(t);
                  const done = t.status === "done";
                  const warn = warnTaskIds.has(t.id);
                  return (
                    <div
                      key={t.id}
                      data-task-row={t.id}
                      className={cn("absolute left-0 right-0 border-b border-black/[0.03]", connect && connect.fromId !== t.id && "hover:bg-teal-light/30")}
                      style={{ top, height: ROW_H }}
                      onClick={(e) => {
                        // 日程未設定タスク: クリック位置の日付を期日に設定
                        if (!sp && !drag && !connect) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          p.onPatch(t.id, { due_date: xDay(e.clientX - rect.left) });
                        }
                      }}
                    >
                      {!sp && (
                        <span className="absolute top-1/2 -translate-y-1/2 rounded-md border border-dashed border-black/15 px-2 py-0.5 text-[10px] text-ink/35 pointer-events-none" style={{ left: todayX + 4 }}>
                          クリックで日程を設定
                        </span>
                      )}
                      {sp && t.is_milestone && (
                        <div
                          className="group absolute top-1/2 -translate-y-1/2 cursor-grab touch-none select-none"
                          style={{ left: dayX(sp.e) + ppd / 2 - 8 }}
                          onPointerDown={(e) => startDrag(e, t.id, "move")}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                        >
                          <span className={cn("block h-3.5 w-3.5 rotate-45 rounded-[2px]", done ? "bg-amber-300" : "bg-amber-500", warn && "ring-2 ring-rose-400")} />
                          <ConnectDot onPointerDown={(e) => startConnect(e, t.id)} onPointerMove={moveConnect} onPointerUp={endConnect} className="-right-4" />
                        </div>
                      )}
                      {sp && !t.is_milestone && (
                        <div
                          className={cn(
                            "group absolute flex items-center rounded-md px-1.5 cursor-grab touch-none select-none",
                            done ? "bg-slate-300/70" : barTint(t.color),
                            warn && "ring-2 ring-rose-400",
                            drag?.id === t.id && "opacity-80 cursor-grabbing",
                          )}
                          style={{ left: dayX(sp.s), width: Math.max((diffDays(sp.s, sp.e) + 1) * ppd - 2, 8), top: 6, height: ROW_H - 12 }}
                          onPointerDown={(e) => startDrag(e, t.id, "move")}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          title={t.title}
                        >
                          {ppd * (diffDays(sp.s, sp.e) + 1) > 40 && (
                            <span className={cn("truncate text-[10.5px] font-semibold", done ? "text-ink/40 line-through" : "text-white")}>{t.title}</span>
                          )}
                          {/* リサイズハンドル */}
                          <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md opacity-0 group-hover:opacity-100 bg-black/20" onPointerDown={(e) => startDrag(e, t.id, "resize-l")} onPointerMove={moveDrag} onPointerUp={endDrag} />
                          <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md opacity-0 group-hover:opacity-100 bg-black/20" onPointerDown={(e) => startDrag(e, t.id, "resize-r")} onPointerMove={moveDrag} onPointerUp={endDrag} />
                          <ConnectDot onPointerDown={(e) => startConnect(e, t.id)} onPointerMove={moveConnect} onPointerUp={endConnect} className="-right-3.5" />
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {/* 依存の矢印（SVGオーバーレイ） */}
              <svg className="absolute inset-0 z-[5] pointer-events-none" width={gridW} height={rowsH}>
                <defs>
                  <marker id="dep-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" className="fill-slate-400" />
                  </marker>
                  <marker id="dep-arrow-warn" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" className="fill-rose-500" />
                  </marker>
                </defs>
                {depLines.map((l) => (
                  <path
                    key={l.id}
                    d={elbow(l.x1, l.y1, l.x2, l.y2)}
                    fill="none"
                    strokeWidth={1.5}
                    className={cn("cursor-pointer", l.warn ? "stroke-rose-500" : "stroke-slate-400")}
                    markerEnd={l.warn ? "url(#dep-arrow-warn)" : "url(#dep-arrow)"}
                    style={{ pointerEvents: "stroke" }}
                    onClick={() => {
                      if (window.confirm("この依存関係を削除しますか？")) p.onRemoveDep(l.id);
                    }}
                  >
                    <title>{l.warn ? "日程が矛盾しています（後続が先行の完了前に開始）。クリックで削除" : "依存関係（クリックで削除）"}</title>
                  </path>
                ))}
                {connect && (
                  <path d={elbow(connect.x, connect.y, connect.toX, connect.toY)} fill="none" strokeWidth={1.5} strokeDasharray="4 3" className="stroke-teal-primary" />
                )}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 依存追加用の接続ハンドル（バー右端の◯）。 */
function ConnectDot({
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  className?: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      className={cn(
        "absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-teal-primary bg-white cursor-crosshair opacity-0 group-hover:opacity-100 z-20",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="ドラッグして依存関係を追加"
    />
  );
}

/** 先行終了→後続開始のカギ線パス。 */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  const gap = 8;
  if (x2 >= x1 + gap * 2) {
    const mx = x1 + gap;
    return `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`;
  }
  // 後続が左にある（矛盾等）: 一度下げて回り込む
  const my = y1 < y2 ? y1 + ROW_H / 2 : y1 - ROW_H / 2;
  return `M${x1},${y1} L${x1 + gap},${y1} L${x1 + gap},${my} L${x2 - gap},${my} L${x2 - gap},${y2} L${x2},${y2}`;
}

function MiniAvatar({ user }: { user?: UserVM }) {
  if (!user) return <span className="h-[18px] w-[18px] rounded-full border border-dashed border-black/20 shrink-0" title="未割り当て" />;
  return (
    <span
      className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] font-bold text-white shrink-0"
      style={{ backgroundColor: user.avatarColor ?? "#008C8C" }}
      title={user.name}
    >
      {initials(user.name)}
    </span>
  );
}

/** バーの塗り（タスク色。未設定はティール）。 */
const BAR_TINT: Record<string, string> = {
  teal: "bg-teal-primary",
  orange: "bg-accent-orange",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  lime: "bg-lime-500",
  slate: "bg-slate-400",
};
function barTint(color?: string | null): string {
  return BAR_TINT[color ?? "teal"] ?? "bg-teal-primary";
}
