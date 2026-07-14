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
  Users,
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
  setTaskLabelsAction,
  type TaskInput,
} from "@/server/actions/tasks";

type ViewKind = "list" | "board" | "calendar";

/** 担当者フィルタ: 未割り当てを表す番兵。 */
const UNASSIGNED = "__unassigned__";

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
  /** 担当者フィルタの選択肢（省略時は users 全員）。プロジェクトでは参照メンバーのみを渡す。 */
  filterMembers?: UserVM[];
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

  // 絞り込み: 担当者 + 完了を隠すモード
  const [assignee, setAssignee] = useState<string>("all");
  const [hideDone, setHideDone] = useState(false);

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
  const setLabels = (id: string, labels: string[]) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, labels } : t)));
    startTransition(() => setTaskLabelsAction(id, labels));
  };

  const setView = (v: ViewKind) => {
    const p = new URLSearchParams(params.toString());
    p.set("view", v);
    router.push(`${pathname}?${p.toString()}`);
  };

  const allow = props.allowViews ?? (["list", "board", "calendar"] as ViewKind[]);
  // 担当者フィルタの選択肢: プロジェクトでは参照メンバーのみ（未指定なら全員）
  const assigneeChoices = props.filterMembers && props.filterMembers.length > 0 ? props.filterMembers : users;

  // 担当者で絞り込み → さらに「完了を隠す」で未完了のみに
  const assigneeTasks = useMemo(() => {
    if (assignee === "all") return tasks;
    if (assignee === UNASSIGNED) return tasks.filter((t) => !t.assigned_to);
    return tasks.filter((t) => t.assigned_to === assignee);
  }, [tasks, assignee]);
  const visibleTasks = useMemo(
    () => (hideDone ? assigneeTasks.filter((t) => t.status !== "done") : assigneeTasks),
    [assigneeTasks, hideDone],
  );
  const openCount = assigneeTasks.filter((t) => t.status !== "done").length;
  const doneCount = assigneeTasks.length - openCount;

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
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-1.5">
            <Users size={13} className="text-ink/40" />
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs text-ink/70 outline-none focus:border-teal-primary"
              title="担当者で絞り込み"
            >
              <option value="all">担当: 全員</option>
              {assigneeChoices.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              <option value={UNASSIGNED}>未割り当て</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-ink/60 cursor-pointer select-none" title="完了したタスクを非表示にします">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-teal-primary" />
            完了を隠す
          </label>
          <span className="text-xs text-ink/45">
            未完了 <span className="font-bold text-ink/70 tabular-nums">{openCount}</span> 件
            {!hideDone && doneCount > 0 && <span className="ml-1.5 text-ink/35">/ 完了 {doneCount}</span>}
          </span>
        </div>
      </div>

      {props.view === "board" ? (
        <BoardView
          tasks={visibleTasks}
          sections={sections}
          groupMode={groupMode}
          today={today}
          usersById={usersById}
          onToggle={toggle}
          onReorder={reorder}
          onPatch={patch}
          onSetLabels={setLabels}
          onOpen={setOpenId}
          onCreate={create}
          projectId={projectId}
          currentUserId={currentUserId}
        />
      ) : props.view === "calendar" ? (
        <CalendarView tasks={visibleTasks} today={today} usersById={usersById} onToggle={toggle} onOpen={setOpenId} onCreate={create} projectId={projectId} currentUserId={currentUserId} />
      ) : (
        <ListView
          tasks={visibleTasks}
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
        <TaskDrawer task={openTask} users={users} today={today} onClose={() => setOpenId(null)} onPatch={patch} onSetLabels={setLabels} onToggle={toggle} onDelete={remove} />
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
            seed={{
              section_id: p.groupMode === "section" ? (g.sectionId ?? null) : null,
              due_date: p.groupMode === "date" ? g.defaultDue : null,
            }}
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
type BoardGroup = "section" | "priority" | "label";
const NO_PRI = "__nopri__";
const NO_LABEL = "__nolabel__";

function BoardView(
  p: CommonViewProps & {
    onReorder: (sectionId: string | null, ids: string[]) => void;
    onPatch: (id: string, patch: Partial<TaskInput>) => void;
    onSetLabels: (id: string, labels: string[]) => void;
  },
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [group, setGroup] = useState<BoardGroup>("section");
  const [extraLabels, setExtraLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");

  // マイタスク(date)は期日バケットのまま。プロジェクト(section)のみグルーピング切替可。
  const isProject = p.groupMode === "section";
  const gb: BoardGroup = isProject ? group : "section";
  const cols = boardCols(p.tasks, p.sections, gb, p.groupMode, p.today, extraLabels);
  const draggable = isProject;

  const drop = (colKey: string) => {
    if (!dragId || !draggable) return;
    if (gb === "priority") {
      p.onPatch(dragId, { priority: colKey === NO_PRI ? null : colKey });
    } else if (gb === "label") {
      p.onSetLabels(dragId, colKey === NO_LABEL ? [] : [colKey]);
    } else {
      const col = cols.find((c) => c.key === colKey);
      if (col) {
        const sectionId = colKey === NO_SECTION ? null : colKey;
        const ids = col.tasks.filter((t) => t.id !== dragId).map((t) => t.id);
        ids.push(dragId);
        p.onReorder(sectionId, ids);
      }
    }
    setDragId(null);
    setOverCol(null);
  };

  const seedFor = (c: Column): Partial<TaskInput> => {
    if (gb === "priority") return { priority: c.key === NO_PRI ? "middle" : c.key };
    if (gb === "label") return {};
    return { section_id: c.key === NO_SECTION ? null : c.key, due_date: p.groupMode === "date" ? c.defaultDue : null };
  };

  return (
    <div>
      {isProject && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-ink/40">グルーピング</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-mist-soft p-0.5">
            {([["section", "進捗（セクション）"], ["priority", "優先度"], ["label", "ラベル"]] as [BoardGroup, string][]).map(([g, label]) => (
              <button key={g} type="button" onClick={() => setGroup(g)} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", group === g ? "bg-white text-teal-deep shadow-sm" : "text-ink/50 hover:text-ink/80")}>
                {label}
              </button>
            ))}
          </div>
          {gb === "label" && (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const n = newLabel.trim();
                if (n) setExtraLabels((x) => Array.from(new Set([...x, n])));
                setNewLabel("");
              }}
            >
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="ラベル列を追加" className="rounded-lg border border-black/10 px-2 py-1 text-xs outline-none focus:border-teal-primary w-32" />
              <button type="submit" className="rounded-lg bg-mist-soft px-2 py-1 text-xs text-ink/60 hover:text-teal-deep">＋列</button>
            </form>
          )}
        </div>
      )}

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
              seed={seedFor(c)}
              projectId={p.projectId}
              currentUserId={p.currentUserId}
              onCreate={p.onCreate}
            />
          </div>
        ))}
      </div>
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
      {t.labels && t.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {t.labels.map((l) => (
            <span key={l} className="inline-flex items-center rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
              {l}
            </span>
          ))}
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
  seed,
  projectId,
  currentUserId,
  onCreate,
  compact,
}: {
  seed?: Partial<TaskInput>;
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
      section_id: seed?.section_id ?? null,
      project_id: projectId ?? null,
      due_date: seed?.due_date ?? null,
      assigned_to: currentUserId,
      priority: seed?.priority ?? "middle",
      ...seed,
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
  onSetLabels,
  onToggle,
  onDelete,
}: {
  task: TaskVM;
  users: UserVM[];
  today: string;
  onClose: () => void;
  onPatch: (id: string, p: Partial<TaskInput>) => void;
  onSetLabels: (id: string, labels: string[]) => void;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const done = task.status === "done";
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.id, task.title]);
  const [labelInput, setLabelInput] = useState("");
  const labels = task.labels ?? [];

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

          <Field label="ラベル">
            <div className="flex flex-wrap items-center gap-1.5">
              {labels.map((l) => (
                <span key={l} className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-600">
                  {l}
                  <button type="button" onClick={() => onSetLabels(task.id, labels.filter((x) => x !== l))} className="text-violet-400 hover:text-violet-700">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const n = labelInput.trim();
                    if (n && !labels.includes(n)) onSetLabels(task.id, [...labels, n]);
                    setLabelInput("");
                  }
                }}
                placeholder="＋ラベル"
                className="w-24 rounded-md border border-black/10 px-2 py-0.5 text-xs outline-none focus:border-teal-primary"
              />
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

/** ボードのグルーピング軸に応じた列を返す（進捗/優先度/ラベル）。 */
function boardCols(
  tasks: TaskVM[],
  sections: SectionVM[],
  group: BoardGroup,
  mode: "section" | "date",
  today: string,
  extraLabels: string[],
): Column[] {
  if (mode === "date" || group === "section") return boardColumns(tasks, sections, mode, today);

  if (group === "priority") {
    const defs: { key: string; title: string; dot: string; match: (p?: string | null) => boolean }[] = [
      { key: "high", title: "高", dot: "bg-rose-500", match: (p) => p === "high" },
      { key: "middle", title: "中", dot: "bg-accent-orange", match: (p) => p === "middle" || p == null },
      { key: "low", title: "低", dot: "bg-teal-primary", match: (p) => p === "low" },
    ];
    return defs.map((d) => ({ key: d.key, title: d.title, dot: d.dot, tasks: tasks.filter((t) => d.match(t.priority)).sort(sortTasks) }));
  }

  // label: 代表ラベル（先頭）で1列に配置。
  const used = new Set<string>();
  for (const t of tasks) if (t.labels && t.labels.length) used.add(t.labels[0]);
  const labels = Array.from(new Set([...Array.from(used), ...extraLabels])).sort((a, b) => a.localeCompare(b, "ja"));
  const cols: Column[] = labels.map((l) => ({
    key: l,
    title: l,
    dot: "bg-violet-500",
    tasks: tasks.filter((t) => (t.labels?.[0] ?? null) === l).sort(sortTasks),
  }));
  cols.push({ key: NO_LABEL, title: "ラベルなし", dot: "bg-slate-300", tasks: tasks.filter((t) => !t.labels || t.labels.length === 0).sort(sortTasks) });
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
