"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  List,
  LayoutGrid,
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Flag,
  Trash2,
  Link2,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { PRIORITY_META } from "@/lib/constants";
import { TaskCheckbox } from "./task-checkbox";
import { NO_SECTION, isOverdue, relDue, sortTasks, type SectionVM, type TaskVM, type UserVM } from "./vm";
import {
  toggleTaskDoneAction,
  reorderTasksAction,
  createProjectTaskAction,
  updateTaskAction,
  deleteTaskAction,
  type TaskInput,
} from "@/server/actions/tasks";

type ViewKind = "list" | "board" | "calendar";

interface Props {
  initialTasks: TaskVM[];
  sections: SectionVM[];
  users: UserVM[];
  today: string;
  view: ViewKind;
  /** section = プロジェクト（セクション列）, date = マイタスク（期日グループ） */
  groupMode: "section" | "date";
  projectId?: string;
  currentUserId: string;
  /** 表示できるビュー。省略時は全ビュー。 */
  allowViews?: ViewKind[];
}

/* ---------- 小物 ---------- */
function AvatarMini({ user, size = 22 }: { user?: UserVM; size?: number }) {
  if (!user) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full border border-dashed border-black/20 text-ink/30"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        title="未割り当て"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-bold shrink-0"
      style={{ width: size, height: size, backgroundColor: user.avatarColor ?? "#008C8C", fontSize: size * 0.42 }}
      title={user.name}
    >
      {initials(user.name)}
    </span>
  );
}

function PriorityTag({ p }: { p?: string | null }) {
  if (!p) return null;
  const meta = PRIORITY_META[p];
  if (!meta) return null;
  const tone =
    meta.tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : meta.tone === "orange"
        ? "bg-orange-50 text-orange-600"
        : "bg-teal-light text-teal-deep";
  return <span className={cn("pill text-[10px] px-1.5 py-0", tone)}>優先{meta.label}</span>;
}

function DueChip({ due, today }: { due?: string | null; today: string }) {
  const { label, tone } = relDue(due, today);
  const cls =
    tone === "over"
      ? "text-rose-600 font-semibold"
      : tone === "today"
        ? "text-accent-orange font-semibold"
        : tone === "soon"
          ? "text-teal-deep"
          : tone === "none"
            ? "text-ink/30"
            : "text-ink/50";
  return <span className={cn("text-[11px] tabular-nums whitespace-nowrap", cls)}>{label}</span>;
}

/* ===================================================================== */
export function TaskViews(props: Props) {
  const { sections, users, today, groupMode, projectId, currentUserId } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  // 楽観状態。サーバーデータが変わったら同期する。
  const [tasks, setTasks] = useState<TaskVM[]>(props.initialTasks);
  const sig = useMemo(
    () =>
      props.initialTasks
        .map((t) => `${t.id}:${t.status}:${t.section_id}:${t.sort_order}:${t.title}:${t.due_date}:${t.assigned_to}:${t.priority}`)
        .join("|"),
    [props.initialTasks],
  );
  const lastSig = useRef(sig);
  useEffect(() => {
    if (lastSig.current !== sig) {
      lastSig.current = sig;
      setTasks(props.initialTasks);
    }
  }, [sig, props.initialTasks]);

  const [openId, setOpenId] = useState<string | null>(null);
  const openTask = tasks.find((t) => t.id === openId) ?? null;

  /* ---- アクション（楽観 + サーバー） ---- */
  const toggle = (id: string, done: boolean) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: done ? "done" : "todo" } : t)));
    startTransition(() => toggleTaskDoneAction(id, done));
  };
  const patch = (id: string, p: Partial<TaskInput>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...(p as Partial<TaskVM>) } : t)));
    startTransition(() => updateTaskAction(id, p));
  };
  const remove = (id: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    setOpenId(null);
    startTransition(() => deleteTaskAction(id));
  };
  const create = (input: TaskInput) => {
    const temp: TaskVM = {
      id: `temp-${Date.now()}`,
      title: input.title,
      status: "todo",
      priority: input.priority ?? "middle",
      due_date: input.due_date ?? null,
      assigned_to: input.assigned_to ?? currentUserId,
      section_id: input.section_id ?? null,
      project_id: input.project_id ?? projectId ?? null,
      sort_order: 9999,
    };
    setTasks((ts) => [...ts, temp]);
    startTransition(() => createProjectTaskAction(input));
  };
  const reorder = (sectionId: string | null, orderedIds: string[]) => {
    setTasks((ts) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      return ts.map((t) =>
        orderMap.has(t.id) ? { ...t, section_id: sectionId, sort_order: orderMap.get(t.id)! } : t,
      );
    });
    startTransition(() => reorderTasksAction(sectionId, orderedIds));
  };

  const setView = (v: ViewKind) => {
    const p = new URLSearchParams(params.toString());
    p.set("view", v);
    router.push(`${pathname}?${p.toString()}`);
  };

  const allow = props.allowViews ?? (["list", "board", "calendar"] as ViewKind[]);
  const openCount = tasks.filter((t) => t.status !== "done").length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="inline-flex items-center gap-0.5 rounded-xl bg-mist-soft p-1">
          {allow.includes("list") && (
            <button type="button" onClick={() => setView("list")} className={cn("seg", props.view === "list" ? "seg-on" : "seg-off")}>
              <List size={15} /> リスト
            </button>
          )}
          {allow.includes("board") && (
            <button type="button" onClick={() => setView("board")} className={cn("seg", props.view === "board" ? "seg-on" : "seg-off")}>
              <LayoutGrid size={15} /> ボード
            </button>
          )}
          {allow.includes("calendar") && (
            <button type="button" onClick={() => setView("calendar")} className={cn("seg", props.view === "calendar" ? "seg-on" : "seg-off")}>
              <CalendarDays size={15} /> カレンダー
            </button>
          )}
        </div>
        <span className="text-xs text-ink/45">
          未完了 <span className="font-bold text-ink/70 tabular-nums">{openCount}</span> 件
        </span>
      </div>

      {props.view === "board" ? (
        <BoardView
          tasks={tasks}
          sections={sections}
          groupMode={groupMode}
          today={today}
          usersById={usersById}
          onToggle={toggle}
          onReorder={reorder}
          onOpen={setOpenId}
          onCreate={create}
          projectId={projectId}
          currentUserId={currentUserId}
        />
      ) : props.view === "calendar" ? (
        <CalendarView tasks={tasks} today={today} usersById={usersById} onToggle={toggle} onOpen={setOpenId} onCreate={create} projectId={projectId} currentUserId={currentUserId} />
      ) : (
        <ListView
          tasks={tasks}
          sections={sections}
          groupMode={groupMode}
          today={today}
          usersById={usersById}
          onToggle={toggle}
          onOpen={setOpenId}
          onCreate={create}
          projectId={projectId}
          currentUserId={currentUserId}
        />
      )}

      {openTask && (
        <TaskDrawer task={openTask} users={users} today={today} onClose={() => setOpenId(null)} onPatch={patch} onToggle={toggle} onDelete={remove} />
      )}
    </div>
  );
}

/* ===================== リストビュー ===================== */
interface CommonViewProps {
  tasks: TaskVM[];
  sections: SectionVM[];
  groupMode: "section" | "date";
  today: string;
  usersById: Map<string, UserVM>;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
  onCreate: (input: TaskInput) => void;
  projectId?: string;
  currentUserId: string;
}

function ListView(p: CommonViewProps) {
  const groups = groupTasks(p.tasks, p.sections, p.groupMode, p.today);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key} className="card overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <span className={cn("h-2 w-2 rounded-full", g.dot)} />
            <span className="text-sm font-bold text-ink">{g.title}</span>
            <span className="pill bg-mist-soft text-ink/50 text-[10px]">{g.tasks.length}</span>
          </div>
          <ul className="divide-y divide-black/[0.04]">
            {g.tasks.map((t) => (
              <ListRow key={t.id} t={t} today={p.today} user={p.usersById.get(t.assigned_to ?? "")} onToggle={p.onToggle} onOpen={p.onOpen} />
            ))}
          </ul>
          <QuickAdd
            sectionId={p.groupMode === "section" ? (g.sectionId ?? null) : null}
            defaultDue={p.groupMode === "date" ? g.defaultDue : null}
            projectId={p.projectId}
            currentUserId={p.currentUserId}
            onCreate={p.onCreate}
          />
        </div>
      ))}
    </div>
  );
}

function ListRow({
  t,
  today,
  user,
  onToggle,
  onOpen,
}: {
  t: TaskVM;
  today: string;
  user?: UserVM;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const done = t.status === "done";
  return (
    <li className={cn("group flex items-center gap-3 px-4 py-2.5 hover:bg-mist-soft/50 transition-colors", done && "animate-row-complete")}>
      <TaskCheckbox done={done} onToggle={(next) => onToggle(t.id, next)} />
      <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
        <span className={cn("text-sm", done ? "line-through text-ink/35" : "text-ink")}>{t.title}</span>
        {(t.projectName || t.accountName) && (
          <span className="ml-2 text-[11px] text-ink/40">
            {t.projectName && (
              <span className="inline-flex items-center gap-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", dotClass(t.projectColor))} />
                {t.projectName}
              </span>
            )}
            {t.accountName && <span className="ml-2">{t.accountName}</span>}
          </span>
        )}
      </button>
      <PriorityTag p={t.priority} />
      {t.opportunity_id && (
        <Link href={`/app/opportunities/${t.opportunity_id}`} className="text-ink/30 hover:text-teal-deep" title="関連案件を開く" onClick={(e) => e.stopPropagation()}>
          <Link2 size={13} />
        </Link>
      )}
      <DueChip due={t.due_date} today={today} />
      <AvatarMini user={user} size={22} />
    </li>
  );
}

/* ===================== ボードビュー ===================== */
function BoardView(p: CommonViewProps & { onReorder: (sectionId: string | null, ids: string[]) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const cols = boardColumns(p.tasks, p.sections, p.groupMode, p.today);
  const draggable = p.groupMode === "section";

  const drop = (colId: string) => {
    if (!dragId || !draggable) return;
    const col = cols.find((c) => c.key === colId);
    if (!col) return;
    const sectionId = colId === NO_SECTION ? null : colId;
    const ids = col.tasks.filter((t) => t.id !== dragId).map((t) => t.id);
    ids.push(dragId); // 末尾に追加
    p.onReorder(sectionId, ids);
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {cols.map((c) => (
        <div
          key={c.key}
          className={cn("task-col", overCol === c.key && draggable && "ring-2 ring-teal-primary/40")}
          onDragOver={(e) => {
            if (draggable) {
              e.preventDefault();
              setOverCol(c.key);
            }
          }}
          onDragLeave={() => setOverCol((v) => (v === c.key ? null : v))}
          onDrop={() => drop(c.key)}
        >
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className={cn("h-2 w-2 rounded-full", c.dot)} />
            <span className="text-xs font-bold text-ink/80">{c.title}</span>
            <span className="pill bg-white text-ink/45 text-[10px]">{c.tasks.length}</span>
          </div>
          <div className="flex flex-col gap-2 px-0.5 min-h-[8px]">
            {c.tasks.map((t) => (
              <BoardCard
                key={t.id}
                t={t}
                today={p.today}
                user={p.usersById.get(t.assigned_to ?? "")}
                draggable={draggable}
                dragging={dragId === t.id}
                onToggle={p.onToggle}
                onOpen={p.onOpen}
                onDragStart={() => setDragId(t.id)}
                onDragEnd={() => setDragId(null)}
              />
            ))}
          </div>
          <QuickAdd
            compact
            sectionId={c.key === NO_SECTION ? null : c.key}
            defaultDue={p.groupMode === "date" ? c.defaultDue : null}
            projectId={p.projectId}
            currentUserId={p.currentUserId}
            onCreate={p.onCreate}
          />
        </div>
      ))}
    </div>
  );
}

function BoardCard({
  t,
  today,
  user,
  draggable,
  dragging,
  onToggle,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  t: TaskVM;
  today: string;
  user?: UserVM;
  draggable: boolean;
  dragging: boolean;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const done = t.status === "done";
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn("task-card", dragging && "opacity-40", done && "bg-mist-soft/60")}
    >
      <div className="flex items-start gap-2">
        <TaskCheckbox done={done} onToggle={(next) => onToggle(t.id, next)} size={18} />
        <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
          <div className={cn("text-[13px] leading-snug", done ? "line-through text-ink/35" : "text-ink")}>{t.title}</div>
        </button>
      </div>
      {(t.projectName || t.accountName) && (
        <div className="mt-1.5 text-[10px] text-ink/40 truncate">
          {t.projectName && (
            <span className="inline-flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", dotClass(t.projectColor))} />
              {t.projectName}
            </span>
          )}
          {t.accountName && <span className="ml-1.5">{t.accountName}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <PriorityTag p={t.priority} />
        <DueChip due={t.due_date} today={today} />
        <span className="ml-auto">
          <AvatarMini user={user} size={20} />
        </span>
      </div>
    </div>
  );
}

/* ===================== カレンダービュー ===================== */
function CalendarView(p: Omit<CommonViewProps, "sections" | "groupMode">) {
  const [monthAnchor, setMonthAnchor] = useState(() => p.today.slice(0, 7)); // YYYY-MM
  const [y, m] = monthAnchor.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();

  const byDate = new Map<string, TaskVM[]>();
  for (const t of p.tasks) {
    if (!t.due_date) continue;
    (byDate.get(t.due_date) ?? byDate.set(t.due_date, []).get(t.due_date)!).push(t);
  }

  const cells: (string | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${monthAnchor}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta: number) => {
    const nm = new Date(y, m - 1 + delta, 1);
    setMonthAnchor(`${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-ink">
          {y}年{m}月
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="rounded-lg p-1.5 hover:bg-mist-soft text-ink/50">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => setMonthAnchor(p.today.slice(0, 7))} className="rounded-lg px-2 py-1 text-xs hover:bg-mist-soft text-ink/60">
            今月
          </button>
          <button type="button" onClick={() => shift(1)} className="rounded-lg p-1.5 hover:bg-mist-soft text-ink/50">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink/40 mb-1">
        {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-[92px] rounded-lg bg-mist-soft/30" />;
          const day = Number(date.slice(-2));
          const isToday = date === p.today;
          const items = (byDate.get(date) ?? []).sort(sortTasks);
          return (
            <div key={i} className={cn("min-h-[92px] rounded-lg border p-1.5 flex flex-col", isToday ? "border-teal-primary bg-teal-light/30" : "border-black/[0.05] bg-white")}>
              <div className={cn("text-[11px] font-semibold mb-1", isToday ? "text-teal-deep" : "text-ink/40")}>{day}</div>
              <div className="space-y-1 overflow-hidden">
                {items.slice(0, 4).map((t) => {
                  const done = t.status === "done";
                  const od = isOverdue(t, p.today);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => p.onOpen(t.id)}
                      className={cn(
                        "block w-full truncate rounded px-1.5 py-0.5 text-left text-[10.5px]",
                        done ? "bg-mist-soft text-ink/35 line-through" : od ? "bg-rose-50 text-rose-600" : "bg-teal-light/60 text-teal-deep",
                      )}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                  );
                })}
                {items.length > 4 && <div className="text-[10px] text-ink/40 px-1">＋{items.length - 4}件</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== クイック追加 ===================== */
function QuickAdd({
  sectionId,
  defaultDue,
  projectId,
  currentUserId,
  onCreate,
  compact,
}: {
  sectionId: string | null;
  defaultDue?: string | null;
  projectId?: string;
  currentUserId: string;
  onCreate: (input: TaskInput) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = title.trim();
    if (!t) {
      setOpen(false);
      return;
    }
    onCreate({
      title: t,
      section_id: sectionId,
      project_id: projectId ?? null,
      due_date: defaultDue ?? null,
      assigned_to: currentUserId,
      priority: "middle",
    });
    setTitle("");
    ref.current?.focus();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => ref.current?.focus(), 0);
        }}
        className={cn(
          "flex w-full items-center gap-1.5 text-[12px] text-ink/40 hover:text-teal-deep transition-colors",
          compact ? "px-2 py-1.5" : "px-4 py-2.5 border-t border-black/[0.04]",
        )}
      >
        <Plus size={14} /> タスクを追加
      </button>
    );
  }
  return (
    <div className={cn(compact ? "px-1.5 py-1.5" : "px-4 py-2.5 border-t border-black/[0.04]")}>
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={submit}
        placeholder="タスク名を入力し Enter"
        className="input py-1.5 text-sm"
      />
    </div>
  );
}

/* ===================== 詳細ドロワー ===================== */
function TaskDrawer({
  task,
  users,
  today,
  onClose,
  onPatch,
  onToggle,
  onDelete,
}: {
  task: TaskVM;
  users: UserVM[];
  today: string;
  onClose: () => void;
  onPatch: (id: string, p: Partial<TaskInput>) => void;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const done = task.status === "done";
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.id, task.title]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <div className="relative z-10 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-[slidein_0.2s_ease-out]">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
          <button
            type="button"
            onClick={() => onToggle(task.id, !done)}
            className={cn("inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors", done ? "bg-teal-light text-teal-deep" : "text-ink/60 hover:bg-mist-soft")}
          >
            <TaskCheckbox done={done} onToggle={(next) => onToggle(task.id, next)} size={18} />
            {done ? "完了済み" : "完了にする"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink/40 hover:bg-mist-soft">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && onPatch(task.id, { title: title.trim() })}
            className={cn("w-full text-lg font-bold text-ink bg-transparent outline-none border-b border-transparent focus:border-teal-primary/40 pb-1", done && "line-through text-ink/40")}
          />

          <Field label="担当">
            <select
              value={task.assigned_to ?? ""}
              onChange={(e) => onPatch(task.id, { assigned_to: e.target.value || null })}
              className="input py-1.5"
            >
              <option value="">未割り当て</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日">
              <input type="date" value={task.start_date ?? ""} onChange={(e) => onPatch(task.id, { start_date: e.target.value || null })} className="input py-1.5" />
            </Field>
            <Field label="期日">
              <input type="date" value={task.due_date ?? ""} onChange={(e) => onPatch(task.id, { due_date: e.target.value || null })} className="input py-1.5" />
            </Field>
          </div>

          <Field label="優先度">
            <div className="flex gap-1.5">
              {(["high", "middle", "low"] as const).map((pk) => {
                const on = (task.priority ?? "middle") === pk;
                return (
                  <button
                    key={pk}
                    type="button"
                    onClick={() => onPatch(task.id, { priority: pk })}
                    className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors", on ? "border-teal-primary bg-teal-light text-teal-deep" : "border-black/10 text-ink/50 hover:bg-mist-soft")}
                  >
                    <Flag size={12} />
                    {PRIORITY_META[pk].label}
                  </button>
                );
              })}
            </div>
          </Field>

          {task.opportunity_id && (
            <Link href={`/app/opportunities/${task.opportunity_id}`} className="inline-flex items-center gap-1.5 text-sm text-teal-deep hover:underline">
              <Link2 size={14} /> 関連案件を開く
            </Link>
          )}

          <div className="text-[11px] text-ink/40">
            {relDue(task.due_date, today).label}
            {task.projectName && (
              <span className="ml-2 inline-flex items-center gap-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", dotClass(task.projectColor))} />
                {task.projectName}
              </span>
            )}
          </div>
        </div>

        <div className="border-t border-black/[0.06] px-5 py-3">
          <button type="button" onClick={() => onDelete(task.id)} className="inline-flex items-center gap-1.5 text-sm text-rose-500 hover:text-rose-600">
            <Trash2 size={14} /> タスクを削除
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

/* ===================== グルーピングのロジック ===================== */
interface Group {
  key: string;
  title: string;
  dot: string;
  tasks: TaskVM[];
  sectionId?: string | null;
  defaultDue?: string | null;
}

function groupTasks(tasks: TaskVM[], sections: SectionVM[], mode: "section" | "date", today: string): Group[] {
  if (mode === "section") {
    const cols = boardColumns(tasks, sections, mode, today);
    return cols.map((c) => ({ key: c.key, title: c.title, dot: c.dot, tasks: c.tasks, sectionId: c.key === NO_SECTION ? null : c.key }));
  }
  return dateGroups(tasks, today).map((g) => ({ key: g.key, title: g.title, dot: g.dot, tasks: g.tasks, defaultDue: g.defaultDue }));
}

interface Column {
  key: string;
  title: string;
  dot: string;
  tasks: TaskVM[];
  defaultDue?: string | null;
}

function boardColumns(tasks: TaskVM[], sections: SectionVM[], mode: "section" | "date", today: string): Column[] {
  if (mode === "date") {
    return dateGroups(tasks, today).map((g) => ({ key: g.key, title: g.title, dot: g.dot, tasks: g.tasks, defaultDue: g.defaultDue }));
  }
  const cols: Column[] = sections.map((s) => ({
    key: s.id,
    title: s.name,
    dot: "bg-teal-primary",
    tasks: tasks.filter((t) => t.section_id === s.id).sort(sortTasks),
  }));
  const orphan = tasks.filter((t) => !t.section_id).sort(sortTasks);
  if (orphan.length > 0 || sections.length === 0) {
    cols.unshift({ key: NO_SECTION, title: "未分類", dot: "bg-slate-300", tasks: orphan });
  }
  return cols;
}

function dateGroups(tasks: TaskVM[], today: string): (Column & { defaultDue: string | null })[] {
  const t = new Date(today + "T00:00:00");
  const plus = (n: number) => {
    const d = new Date(t);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekEnd = plus(7);
  const open = tasks.filter((x) => x.status !== "done");
  const done = tasks.filter((x) => x.status === "done").sort(sortTasks);

  const overdue = open.filter((x) => x.due_date && x.due_date < today).sort(sortTasks);
  const todayT = open.filter((x) => x.due_date === today).sort(sortTasks);
  const week = open.filter((x) => x.due_date && x.due_date > today && x.due_date <= weekEnd).sort(sortTasks);
  const later = open.filter((x) => x.due_date && x.due_date > weekEnd).sort(sortTasks);
  const noDue = open.filter((x) => !x.due_date).sort(sortTasks);

  const groups: (Column & { defaultDue: string | null })[] = [
    { key: "overdue", title: "期限切れ", dot: "bg-rose-500", tasks: overdue, defaultDue: today },
    { key: "today", title: "今日", dot: "bg-accent-orange", tasks: todayT, defaultDue: today },
    { key: "week", title: "今後7日", dot: "bg-teal-primary", tasks: week, defaultDue: plus(1) },
    { key: "later", title: "それ以降", dot: "bg-sky-400", tasks: later, defaultDue: weekEnd },
    { key: "nodue", title: "期日なし", dot: "bg-slate-300", tasks: noDue, defaultDue: null },
  ];
  if (done.length > 0) groups.push({ key: "done", title: "完了", dot: "bg-slate-300", tasks: done, defaultDue: null });
  return groups.filter((g) => g.tasks.length > 0 || g.key === "today");
}

function dotClass(color?: string | null): string {
  const map: Record<string, string> = {
    teal: "bg-teal-primary",
    orange: "bg-accent-orange",
    violet: "bg-violet-500",
    rose: "bg-rose-500",
    amber: "bg-amber-500",
    sky: "bg-sky-500",
    lime: "bg-lime-500",
    slate: "bg-slate-400",
  };
  return map[color ?? "teal"] ?? "bg-teal-primary";
}
