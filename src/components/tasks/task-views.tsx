"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  List,
  LayoutGrid,
  CalendarDays,
  GanttChart,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Flag,
  Trash2,
  Link2,
  ExternalLink,
  Users,
  Repeat,
  CornerDownRight,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { recurrenceSummary, type Recurrence, type RecurrenceFreq } from "@/lib/recurrence";
import { PRIORITY_META, COLOR_KEYS } from "@/lib/constants";
import { TaskCheckbox } from "./task-checkbox";
import { TimelineView } from "./timeline-view";
import { NO_SECTION, isOverdue, relDue, sortTasks, type DepVM, type SectionVM, type TaskVM, type UserVM } from "./vm";
import {
  toggleTaskDoneAction,
  reorderTasksAction,
  createProjectTaskAction,
  updateTaskAction,
  deleteTaskAction,
  setTaskLabelsAction,
  addTaskDependencyAction,
  removeTaskDependencyAction,
  type TaskInput,
} from "@/server/actions/tasks";

type ViewKind = "list" | "board" | "calendar" | "timeline";

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
  /** 表示できるビュー。省略時は list/board/calendar（タイムラインはプロジェクトのみ）。 */
  allowViews?: ViewKind[];
  /** 担当者フィルタの選択肢（省略時は users 全員）。プロジェクトでは参照メンバーのみを渡す。 */
  filterMembers?: UserVM[];
  /** 依存関係（F-201）。タイムラインを許可するプロジェクトで渡す。 */
  deps?: DepVM[];
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
        .map(
          (t) =>
            `${t.id}:${t.status}:${t.section_id}:${t.sort_order}:${t.title}:${t.due_date}:${t.start_date}:${t.assigned_to}:${t.priority}:${t.is_milestone ? 1 : 0}:${t.parent_task_id ?? ""}:${t.recurrence ? recurrenceSummary(t.recurrence) : ""}`,
        )
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

  // 依存関係（F-201）。楽観状態。サーバーデータが変わったら同期する。
  const [deps, setDeps] = useState<DepVM[]>(props.deps ?? []);
  const depSig = useMemo(() => (props.deps ?? []).map((d) => d.id).join("|"), [props.deps]);
  const lastDepSig = useRef(depSig);
  useEffect(() => {
    if (lastDepSig.current !== depSig) {
      lastDepSig.current = depSig;
      setDeps(props.deps ?? []);
    }
  }, [depSig, props.deps]);

  const [openId, setOpenId] = useState<string | null>(null);
  const openTask = tasks.find((t) => t.id === openId) ?? null;

  // 絞り込み: 担当者 + 完了を隠すモード + サブタスク表示（プロジェクトのみ）
  const [assignee, setAssignee] = useState<string>("all");
  const [hideDone, setHideDone] = useState(false);
  const [showSubs, setShowSubs] = useState(false);

  // 「完了」セクション（プロジェクトのみ）。完了にしたら自動でここへ移す。
  const doneSectionId = useMemo(
    () => (groupMode === "section" ? sections.find((s) => /完了|done/i.test(s.name))?.id ?? null : null),
    [groupMode, sections],
  );

  /* ---- アクション（楽観 + サーバー） ---- */
  const toggle = (id: string, done: boolean) => {
    let completeSubtasks = false;
    if (done) {
      // 先行タスクが未完了のまま完了しようとしたら確認（ブロックはしない）
      const openPreds = deps
        .filter((d) => d.successor_task_id === id)
        .map((d) => tasks.find((t) => t.id === d.predecessor_task_id))
        .filter((t): t is TaskVM => !!t && t.status !== "done");
      if (openPreds.length > 0 && !window.confirm(`先行タスクが未完了です（${openPreds.map((t) => t.title).join(" / ")}）。完了にしますか？`)) {
        return;
      }
      // 未完了サブタスクが残る親の完了は確認し、まとめて完了も選べるようにする
      const openKids = tasks.filter((t) => t.parent_task_id === id && t.status !== "done");
      if (openKids.length > 0) {
        if (!window.confirm(`未完了のサブタスクが${openKids.length}件あります。親タスクを完了にしますか？`)) return;
        completeSubtasks = window.confirm("未完了のサブタスクもまとめて完了にしますか？");
      }
    }
    const moveToDone = done && !!doneSectionId;
    setTasks((ts) =>
      ts.map((t) =>
        t.id === id
          ? { ...t, status: done ? "done" : "todo", ...(moveToDone ? { section_id: doneSectionId! } : {}) }
          : completeSubtasks && t.parent_task_id === id
            ? { ...t, status: "done" }
            : t,
      ),
    );
    startTransition(() => toggleTaskDoneAction(id, done, { completeSubtasks }));
    // 完了にしたら「完了」セクションへ自動移動（すでに完了列にいる場合は何もしない）
    if (moveToDone) {
      const cur = tasks.find((t) => t.id === id);
      if (cur && cur.section_id !== doneSectionId) {
        startTransition(() => updateTaskAction(id, { section_id: doneSectionId }));
      }
    }
  };
  const patch = (id: string, p: Partial<TaskInput>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...(p as Partial<TaskVM>) } : t)));
    startTransition(() => updateTaskAction(id, p));
  };
  const remove = (id: string) => {
    const kids = tasks.filter((t) => t.parent_task_id === id);
    if (kids.length > 0 && !window.confirm(`サブタスク${kids.length}件も一緒に削除されます。削除しますか？`)) return;
    setTasks((ts) => ts.filter((t) => t.id !== id && t.parent_task_id !== id));
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
      parent_task_id: input.parent_task_id ?? null,
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
  const addDep = (predecessorId: string, successorId: string) => {
    if (deps.some((d) => d.predecessor_task_id === predecessorId && d.successor_task_id === successorId)) return;
    const temp: DepVM = { id: `temp-${predecessorId}-${successorId}`, predecessor_task_id: predecessorId, successor_task_id: successorId };
    setDeps((ds) => [...ds, temp]);
    void addTaskDependencyAction(predecessorId, successorId).then((res) => {
      if (!res.ok) {
        setDeps((ds) => ds.filter((d) => d.id !== temp.id));
        window.alert(res.error ?? "依存関係を追加できませんでした");
      } else if (res.id) {
        setDeps((ds) => ds.map((d) => (d.id === temp.id ? { ...d, id: res.id! } : d)));
      }
    });
  };
  const removeDep = (id: string) => {
    setDeps((ds) => ds.filter((d) => d.id !== id));
    startTransition(() => removeTaskDependencyAction(id));
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
  // サブタスク進捗（済n/全m）。楽観状態の tasks 全体から数える。
  const subCounts = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      if (!t.parent_task_id) continue;
      const c = m.get(t.parent_task_id) ?? { done: 0, total: 0 };
      c.total += 1;
      if (t.status === "done") c.done += 1;
      m.set(t.parent_task_id, c);
    }
    return m;
  }, [tasks]);
  const hasSubs = subCounts.size > 0;

  const visibleTasks = useMemo(() => {
    let ts = hideDone ? assigneeTasks.filter((t) => t.status !== "done") : assigneeTasks;
    // プロジェクト表示ではサブタスクを既定で畳む（マイタスクでは自分担当分を常に表示）
    if (groupMode === "section" && !showSubs) ts = ts.filter((t) => !t.parent_task_id);
    return ts.map((t) => {
      const c = subCounts.get(t.id);
      return c ? { ...t, subDone: c.done, subTotal: c.total } : t;
    });
  }, [assigneeTasks, hideDone, groupMode, showSubs, subCounts]);
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
          {allow.includes("timeline") && (
            <button type="button" onClick={() => setView("timeline")} className={cn("seg", props.view === "timeline" ? "seg-on" : "seg-off")}>
              <GanttChart size={15} /> タイムライン
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
          {groupMode === "section" && hasSubs && (
            <label className="inline-flex items-center gap-1.5 text-xs text-ink/60 cursor-pointer select-none" title="サブタスクを一覧にも表示します">
              <input type="checkbox" checked={showSubs} onChange={(e) => setShowSubs(e.target.checked)} className="accent-teal-primary" />
              サブタスクを表示
            </label>
          )}
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
      ) : props.view === "timeline" && allow.includes("timeline") ? (
        <TimelineView
          tasks={visibleTasks}
          sections={sections}
          deps={deps}
          today={today}
          usersById={usersById}
          onToggle={toggle}
          onOpen={setOpenId}
          onPatch={patch}
          onAddDep={addDep}
          onRemoveDep={removeDep}
        />
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
        <TaskDrawer
          task={openTask}
          users={users}
          today={today}
          allTasks={tasks}
          deps={deps}
          onClose={() => setOpenId(null)}
          onPatch={patch}
          onSetLabels={setLabels}
          onToggle={toggle}
          onDelete={remove}
          onAddDep={addDep}
          onRemoveDep={removeDep}
          onCreate={create}
          onOpen={setOpenId}
        />
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
    <li className={cn("group flex items-center gap-3 px-4 py-2.5 hover:bg-mist-soft/50 transition-colors", cardTint(t.color), done && "animate-row-complete")}>
      <TaskCheckbox done={done} onToggle={(next) => onToggle(t.id, next)} />
      <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
        {t.parent_task_id && <CornerDownRight size={12} className="mr-1 inline text-ink/30" />}
        {t.is_milestone && <span className="mr-1.5 inline-block h-2 w-2 rotate-45 bg-amber-500" title="マイルストーン" />}
        <span className={cn("text-sm", done ? "line-through text-ink/35" : "text-ink")}>{t.title}</span>
        {t.parentTitle && <span className="ml-1.5 text-[10px] text-ink/35">↳ {t.parentTitle}</span>}
        {t.recurrence && (
          <span className="ml-1.5 inline-flex" title={recurrenceSummary(t.recurrence)}>
            <Repeat size={11} className="inline text-teal-deep/60" />
          </span>
        )}
        {t.subTotal ? <span className="ml-1.5 pill bg-mist-soft text-ink/50 text-[10px]">済{t.subDone}/全{t.subTotal}</span> : null}
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
      {t.url && (
        <a
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink/30 hover:text-teal-deep"
          title="リンクを開く"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={13} />
        </a>
      )}
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
  // ドロップ挿入位置(同一列の上下並び替え用): どのカードの前/後に入れるか
  const [overCard, setOverCard] = useState<{ col: string; id: string; pos: "before" | "after" } | null>(null);
  const [group, setGroup] = useState<BoardGroup>("section");
  const [extraLabels, setExtraLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");

  // マイタスク(date)は期日バケットのまま。プロジェクト(section)のみグルーピング切替可。
  const isProject = p.groupMode === "section";
  const gb: BoardGroup = isProject ? group : "section";
  const cols = boardCols(p.tasks, p.sections, gb, p.groupMode, p.today, extraLabels);
  const draggable = isProject;

  const clearDrag = () => { setDragId(null); setOverCol(null); setOverCard(null); };

  const drop = (colKey: string) => {
    if (!dragId || !draggable) return clearDrag();
    if (gb === "priority") {
      p.onPatch(dragId, { priority: colKey === NO_PRI ? null : colKey });
    } else if (gb === "label") {
      p.onSetLabels(dragId, colKey === NO_LABEL ? [] : [colKey]);
    } else {
      // セクション: 同一列内の上下並び替え＆列跨ぎ移動。挿入位置は overCard で決める。
      const col = cols.find((c) => c.key === colKey);
      if (col) {
        const sectionId = colKey === NO_SECTION ? null : colKey;
        const ids = col.tasks.filter((t) => t.id !== dragId).map((t) => t.id);
        let insertAt = ids.length;
        if (overCard && overCard.col === colKey) {
          const idx = ids.indexOf(overCard.id);
          if (idx >= 0) insertAt = overCard.pos === "before" ? idx : idx + 1;
        }
        ids.splice(insertAt, 0, dragId);
        p.onReorder(sectionId, ids);
      }
    }
    clearDrag();
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
                  dropHint={overCard && overCard.col === c.key && overCard.id === t.id ? overCard.pos : null}
                  onToggle={p.onToggle}
                  onOpen={p.onOpen}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={clearDrag}
                  onDragOverCard={(pos) => {
                    if (draggable && gb === "section" && dragId && dragId !== t.id) {
                      setOverCard((v) => (v && v.col === c.key && v.id === t.id && v.pos === pos ? v : { col: c.key, id: t.id, pos }));
                    }
                  }}
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
  dropHint,
  onToggle,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOverCard,
}: {
  t: TaskVM;
  today: string;
  user?: UserVM;
  draggable: boolean;
  dragging: boolean;
  dropHint: "before" | "after" | null;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverCard: (pos: "before" | "after") => void;
}) {
  const done = t.status === "done";
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverCard(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }}
      className={cn(
        "task-card",
        dragging && "opacity-40",
        cardTint(t.color),
        done && "bg-mist-soft/60",
        dropHint === "before" && "shadow-[inset_0_3px_0_0_var(--tw-shadow-color)] shadow-teal-primary",
        dropHint === "after" && "shadow-[inset_0_-3px_0_0_var(--tw-shadow-color)] shadow-teal-primary",
      )}
    >
      <div className="flex items-start gap-2">
        <TaskCheckbox done={done} onToggle={(next) => onToggle(t.id, next)} size={18} />
        <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
          <div className={cn("text-[13px] leading-snug", done ? "line-through text-ink/35" : "text-ink")}>
            {t.is_milestone && <span className="mr-1.5 inline-block h-2 w-2 rotate-45 bg-amber-500" title="マイルストーン" />}
            {t.title}
          </div>
          {(t.recurrence || t.subTotal) && (
            <div className="mt-1 flex items-center gap-2">
              {t.recurrence && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-teal-deep/70">
                  <Repeat size={10} /> {recurrenceSummary(t.recurrence)}
                </span>
              )}
              {t.subTotal ? <span className="text-[10px] text-ink/45">済{t.subDone}/全{t.subTotal}</span> : null}
            </div>
          )}
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
        {t.url && (
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-ink/30 hover:text-teal-deep"
            title="リンクを開く"
          >
            <ExternalLink size={13} />
          </a>
        )}
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
                      {t.is_milestone ? `◆ ${t.title}` : t.title}
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
  allTasks,
  deps,
  onClose,
  onPatch,
  onSetLabels,
  onToggle,
  onDelete,
  onAddDep,
  onRemoveDep,
  onCreate,
  onOpen,
}: {
  task: TaskVM;
  users: UserVM[];
  today: string;
  allTasks: TaskVM[];
  deps: DepVM[];
  onClose: () => void;
  onPatch: (id: string, p: Partial<TaskInput>) => void;
  onSetLabels: (id: string, labels: string[]) => void;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
  onAddDep: (predecessorId: string, successorId: string) => void;
  onRemoveDep: (id: string) => void;
  onCreate: (input: TaskInput) => void;
  onOpen: (id: string) => void;
}) {
  const done = task.status === "done";
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.id, task.title]);
  const [description, setDescription] = useState(task.description ?? "");
  useEffect(() => setDescription(task.description ?? ""), [task.id, task.description]);
  const [url, setUrl] = useState(task.url ?? "");
  useEffect(() => setUrl(task.url ?? ""), [task.id, task.url]);
  const [labelInput, setLabelInput] = useState("");
  const labels = task.labels ?? [];

  const saveDescription = () => {
    const next = description.trim();
    if (next !== (task.description ?? "")) onPatch(task.id, { description: next || null });
  };
  const saveUrl = () => {
    const next = url.trim();
    if (next !== (task.url ?? "")) onPatch(task.id, { url: next || null });
  };

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

          <Field label="説明">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              rows={3}
              placeholder="このタスクの内容やメモを記入…"
              className="input py-2 text-sm leading-relaxed resize-y min-h-[64px]"
            />
          </Field>

          <Field label="URLリンク">
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={saveUrl}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder="https://…（資料や関連ページのリンク）"
              className="input py-1.5 text-sm"
            />
            {task.url && (
              <a
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex max-w-full items-center gap-1.5 text-xs text-teal-deep hover:underline"
              >
                <ExternalLink size={13} className="shrink-0" />
                <span className="truncate">{task.url}</span>
              </a>
            )}
          </Field>

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
              <input
                type="date"
                value={task.start_date ?? ""}
                disabled={!!task.is_milestone}
                onChange={(e) => onPatch(task.id, { start_date: e.target.value || null })}
                className="input py-1.5 disabled:opacity-40"
              />
            </Field>
            <Field label="期日">
              <input type="date" value={task.due_date ?? ""} onChange={(e) => onPatch(task.id, { due_date: e.target.value || null })} className="input py-1.5" />
            </Field>
          </div>

          <Field label="マイルストーン">
            <button
              type="button"
              onClick={() =>
                onPatch(
                  task.id,
                  task.is_milestone
                    ? { is_milestone: false }
                    : { is_milestone: true, start_date: null, due_date: task.due_date ?? today },
                )
              }
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                task.is_milestone ? "border-amber-400 bg-amber-50 text-amber-700" : "border-black/10 text-ink/50 hover:bg-mist-soft",
              )}
            >
              <span className={cn("inline-block h-2 w-2 rotate-45", task.is_milestone ? "bg-amber-500" : "bg-ink/25")} />
              {task.is_milestone ? "マイルストーン（期日の一点イベント）" : "マイルストーンにする"}
            </button>
          </Field>

          <RecurrenceEditor task={task} onPatch={onPatch} />

          {/* サブタスクは1階層のみ。自身がサブタスクの場合は出さない。 */}
          {!task.parent_task_id && (
            <SubtaskEditor task={task} allTasks={allTasks} onCreate={onCreate} onToggle={onToggle} onOpen={onOpen} />
          )}

          {task.project_id && (
            <DependencyEditor task={task} allTasks={allTasks} deps={deps} onAddDep={onAddDep} onRemoveDep={onRemoveDep} />
          )}

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

          <Field label="色">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPatch(task.id, { color: null })}
                className={cn(
                  "h-6 w-6 rounded-full border flex items-center justify-center text-ink/40",
                  !task.color ? "border-teal-primary ring-2 ring-teal-primary/30" : "border-black/15 hover:border-black/30",
                )}
                title="色なし"
                aria-label="色なし"
              >
                <X size={12} />
              </button>
              {COLOR_KEYS.map((c) => {
                const on = task.color === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => onPatch(task.id, { color: c.key })}
                    className={cn("h-6 w-6 rounded-full border border-black/5 transition-transform hover:scale-110", c.bg, on && "ring-2 ring-offset-1 ring-ink/40")}
                    title={c.label}
                    aria-label={c.label}
                  />
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

/** サブタスクの編集（F-202）。チェックリスト形式でインライン追加・完了・削除。1階層のみ。 */
function SubtaskEditor({
  task,
  allTasks,
  onCreate,
  onToggle,
  onOpen,
}: {
  task: TaskVM;
  allTasks: TaskVM[];
  onCreate: (input: TaskInput) => void;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const subs = allTasks.filter((t) => t.parent_task_id === task.id).sort(sortTasks);
  const doneN = subs.filter((t) => t.status === "done").length;

  const add = () => {
    const t = title.trim();
    if (!t) return;
    onCreate({
      title: t,
      parent_task_id: task.id,
      project_id: task.project_id ?? null,
      section_id: task.section_id ?? null,
      assigned_to: task.assigned_to ?? null,
      priority: "middle",
    });
    setTitle("");
  };

  return (
    <Field label={`サブタスク${subs.length ? `（済${doneN}/全${subs.length}）` : ""}`}>
      <ul className="space-y-1">
        {subs.map((s) => {
          const d = s.status === "done";
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-mist-soft/50">
              <TaskCheckbox done={d} onToggle={(next) => onToggle(s.id, next)} size={16} />
              <button type="button" onClick={() => onOpen(s.id)} className={cn("min-w-0 flex-1 truncate text-left text-xs", d ? "line-through text-ink/35" : "text-ink/80")}>
                {s.title}
              </button>
              {s.due_date && <span className="text-[10px] text-ink/35 tabular-nums whitespace-nowrap">{s.due_date.slice(5)}</span>}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-center gap-1.5">
        <Plus size={14} className="text-ink/30" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="サブタスクを追加し Enter"
          className="input py-1 text-xs"
        />
      </div>
    </Field>
  );
}

const FREQ_LABEL: Record<RecurrenceFreq, string> = { daily: "毎日", weekly: "毎週", monthly: "毎月", yearly: "毎年" };
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

/** 繰り返しルールの編集（F-202）。完了時に次回タスクを生成する（Asana方式）。 */
function RecurrenceEditor({ task, onPatch }: { task: TaskVM; onPatch: (id: string, p: Partial<TaskInput>) => void }) {
  const r = task.recurrence ?? null;
  const set = (next: Recurrence | null) => onPatch(task.id, { recurrence: next });
  const update = (patch: Partial<Recurrence>) => set({ ...(r ?? { freq: "weekly" }), ...patch } as Recurrence);

  if (!r) {
    return (
      <Field label="繰り返し">
        <button
          type="button"
          onClick={() => set({ freq: "weekly", interval: 1, weekdays: task.due_date ? [new Date(task.due_date + "T00:00:00").getDay()] : [1] })}
          className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-semibold text-ink/50 hover:bg-mist-soft"
        >
          <Repeat size={12} /> 繰り返しを設定
        </button>
        {!task.due_date && <p className="mt-1 text-[10px] text-ink/40">※ 繰り返しの生成には期日が必要です</p>}
      </Field>
    );
  }

  const weekdays = r.weekdays ?? [];
  const toggleWd = (d: number) => update({ weekdays: weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort() });

  return (
    <Field label="繰り返し">
      <div className="rounded-xl border border-teal-primary/30 bg-teal-light/20 p-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-ink/50">間隔</span>
          <input
            type="number"
            min={1}
            value={r.interval ?? 1}
            onChange={(e) => update({ interval: Math.max(1, Number(e.target.value) || 1) })}
            className="w-14 rounded-md border border-black/10 px-1.5 py-1 text-xs"
          />
          <select value={r.freq} onChange={(e) => update({ freq: e.target.value as RecurrenceFreq })} className="rounded-md border border-black/10 px-1.5 py-1 text-xs">
            {(["daily", "weekly", "monthly", "yearly"] as RecurrenceFreq[]).map((f) => (
              <option key={f} value={f}>
                {FREQ_LABEL[f]}
              </option>
            ))}
          </select>
        </div>

        {r.freq === "daily" && (
          <label className="flex items-center gap-1.5 text-xs text-ink/60">
            <input type="checkbox" checked={!!r.weekdaysOnly} onChange={(e) => update({ weekdaysOnly: e.target.checked })} className="accent-teal-primary" />
            平日のみ（土日をスキップ）
          </label>
        )}

        {r.freq === "weekly" && (
          <div className="flex gap-1">
            {DOW.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleWd(d)}
                className={cn("h-6 w-6 rounded-md text-[11px] font-semibold", weekdays.includes(d) ? "bg-teal-primary text-white" : "bg-white text-ink/50 border border-black/10")}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {r.freq === "monthly" && (
          <div className="space-y-1.5">
            <select value={r.monthlyMode ?? "day"} onChange={(e) => update({ monthlyMode: e.target.value as Recurrence["monthlyMode"] })} className="w-full rounded-md border border-black/10 px-1.5 py-1 text-xs">
              <option value="day">日付で指定（毎月○日）</option>
              <option value="nth">曜日で指定（第○×曜）</option>
              <option value="last">月末</option>
            </select>
            {(r.monthlyMode ?? "day") === "day" && (
              <div className="flex items-center gap-1.5 text-xs text-ink/60">
                毎月
                <input type="number" min={1} max={31} value={r.monthDay ?? (task.due_date ? new Date(task.due_date + "T00:00:00").getDate() : 1)} onChange={(e) => update({ monthDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} className="w-14 rounded-md border border-black/10 px-1.5 py-1 text-xs" />
                日
              </div>
            )}
            {r.monthlyMode === "nth" && (
              <div className="flex items-center gap-1.5 text-xs text-ink/60">
                第
                <select value={r.nth ?? 1} onChange={(e) => update({ nth: Number(e.target.value) })} className="rounded-md border border-black/10 px-1.5 py-1 text-xs">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <select value={r.nthWeekday ?? 1} onChange={(e) => update({ nthWeekday: Number(e.target.value) })} className="rounded-md border border-black/10 px-1.5 py-1 text-xs">
                  {DOW.map((label, d) => (
                    <option key={d} value={d}>{label}</option>
                  ))}
                </select>
                曜
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 text-xs text-ink/60">
          <span className="text-[10px] text-ink/50">終了</span>
          <select
            value={r.ends?.kind ?? "none"}
            onChange={(e) => {
              const k = e.target.value;
              update({ ends: k === "on_date" ? { kind: "on_date", date: task.due_date ?? "" } : k === "count" ? { kind: "count", value: 10 } : { kind: "none" } });
            }}
            className="rounded-md border border-black/10 px-1.5 py-1 text-xs"
          >
            <option value="none">なし</option>
            <option value="on_date">指定日まで</option>
            <option value="count">回数</option>
          </select>
          {r.ends?.kind === "on_date" && (
            <input type="date" value={r.ends.date} onChange={(e) => update({ ends: { kind: "on_date", date: e.target.value } })} className="rounded-md border border-black/10 px-1.5 py-1 text-xs" />
          )}
          {r.ends?.kind === "count" && (
            <>
              <input type="number" min={1} value={r.ends.value} onChange={(e) => update({ ends: { kind: "count", value: Math.max(1, Number(e.target.value) || 1), done: r.ends?.kind === "count" ? r.ends.done : undefined } })} className="w-14 rounded-md border border-black/10 px-1.5 py-1 text-xs" />
              回
            </>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] font-semibold text-teal-deep">{recurrenceSummary(r)}</span>
          <button type="button" onClick={() => set(null)} className="text-[11px] text-rose-500 hover:text-rose-600">
            解除
          </button>
        </div>
      </div>
    </Field>
  );
}

/** 依存関係の編集（F-201）。先行/後続の一覧と追加・削除。同一プロジェクト内のみ。 */
function DependencyEditor({
  task,
  allTasks,
  deps,
  onAddDep,
  onRemoveDep,
}: {
  task: TaskVM;
  allTasks: TaskVM[];
  deps: DepVM[];
  onAddDep: (predecessorId: string, successorId: string) => void;
  onRemoveDep: (id: string) => void;
}) {
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const preds = deps.filter((d) => d.successor_task_id === task.id);
  const succs = deps.filter((d) => d.predecessor_task_id === task.id);
  const linked = new Set([task.id, ...preds.map((d) => d.predecessor_task_id), ...succs.map((d) => d.successor_task_id)]);
  const candidates = allTasks.filter((t) => t.project_id === task.project_id && !linked.has(t.id));

  // 日程矛盾の警告: 未完了の先行タスクの終了より前に自分が開始する
  const myStart = task.start_date ?? task.due_date;
  const warn =
    task.status !== "done" &&
    !!myStart &&
    preds.some((d) => {
      const pt = byId.get(d.predecessor_task_id);
      const pEnd = pt?.due_date ?? pt?.start_date;
      return pt && pt.status !== "done" && !!pEnd && myStart < pEnd;
    });

  const row = (d: DepVM, otherId: string) => {
    const t = byId.get(otherId);
    if (!t) return null;
    return (
      <li key={d.id} className="flex items-center gap-2 rounded-lg bg-mist-soft/60 px-2.5 py-1.5">
        <span className={cn("min-w-0 flex-1 truncate text-xs", t.status === "done" ? "line-through text-ink/35" : "text-ink/80")}>{t.title}</span>
        <span className="text-[10px] text-ink/35 tabular-nums whitespace-nowrap">{t.due_date ?? "期日なし"}</span>
        <button type="button" onClick={() => onRemoveDep(d.id)} className="text-ink/30 hover:text-rose-500" title="依存を削除">
          <X size={13} />
        </button>
      </li>
    );
  };

  return (
    <Field label="依存関係">
      {warn && (
        <div className="mb-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-600">
          日程が矛盾しています（未完了の先行タスクより前に開始する予定です）
        </div>
      )}
      <div className="space-y-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold text-ink/40">先行タスク（これが終わってから着手）</div>
          <ul className="space-y-1">{preds.map((d) => row(d, d.predecessor_task_id))}</ul>
          <select
            value=""
            onChange={(e) => e.target.value && onAddDep(e.target.value, task.id)}
            className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs text-ink/60 outline-none focus:border-teal-primary"
          >
            <option value="">＋ 先行タスクを追加…</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold text-ink/40">後続タスク（これの完了を待つ）</div>
          <ul className="space-y-1">{succs.map((d) => row(d, d.successor_task_id))}</ul>
          <select
            value=""
            onChange={(e) => e.target.value && onAddDep(task.id, e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs text-ink/60 outline-none focus:border-teal-primary"
          >
            <option value="">＋ 後続タスクを追加…</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Field>
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

/** カード色（左アクセント＋淡い地色）。未設定は装飾なし。 */
const CARD_TINT: Record<string, string> = {
  teal: "border-l-4 border-l-teal-primary bg-teal-light/25",
  orange: "border-l-4 border-l-accent-orange bg-orange-50/60",
  violet: "border-l-4 border-l-violet-500 bg-violet-50/60",
  rose: "border-l-4 border-l-rose-500 bg-rose-50/60",
  amber: "border-l-4 border-l-amber-500 bg-amber-50/60",
  sky: "border-l-4 border-l-sky-500 bg-sky-50/60",
  lime: "border-l-4 border-l-lime-500 bg-lime-50/60",
  slate: "border-l-4 border-l-slate-400 bg-slate-100/60",
};
function cardTint(color?: string | null): string {
  return color ? CARD_TINT[color] ?? "" : "";
}
