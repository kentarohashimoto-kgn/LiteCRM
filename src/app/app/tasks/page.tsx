import Link from "next/link";
import { Check, RotateCcw, Plus, ListChecks, CalendarClock } from "lucide-react";
import { getWorkspaceLite, type Workspace } from "@/lib/data/workspace";
import { getAccount, getUser, listMembers, listTasks } from "@/lib/data/select";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { setTaskStatusAction, createTaskAction } from "@/server/actions";
import { AssigneeFilter } from "@/components/tasks/assignee-filter";
import { formatDateFull, formatTimeJst, toJstDate } from "@/lib/utils";
import type { Task, Opportunity, User } from "@/lib/types";

export const dynamic = "force-dynamic";

interface MeetingRow {
  id: string; title: string | null; summary: string | null;
  meeting_date: string | null; meeting_at: string | null;
  owner_user_id: string | null;
  opportunity_id: string | null; account_id: string | null;
}

type View = "tasks" | "meetings";

export default async function TasksPage({ searchParams }: { searchParams: { assignee?: string; view?: string } }) {
  const ws = await getWorkspaceLite();
  const allTasks = listTasks(ws);
  const owners = listMembers(ws).map(({ user }) => user);
  const today = new Date().toISOString().slice(0, 10);
  const todayJst = toJstDate(new Date().toISOString()) ?? today;

  const view: View = searchParams.view === "meetings" ? "meetings" : "tasks";

  // 担当別フィルタ(?assignee=)。商談ビューの既定はログイン中の担当者、タスクビューは全件。
  const raw = searchParams.assignee;
  const validId = owners.some((o) => o.id === raw) ? (raw as string) : undefined;
  const effAssignee = validId ?? (raw === "all" ? "all" : view === "meetings" ? ws.ctx.userId : "all");
  const filterId = effAssignee === "all" ? "" : effAssignee;
  const matchUser = (uid?: string | null) => !filterId || uid === filterId;

  const oppById = new Map<string, Opportunity>(ws.opportunities.map((o) => [o.id, o]));

  // 案件ごとの未完了タスク(担当フィルタ適用)
  const tasksByOpp = new Map<string, Task[]>();
  for (const t of allTasks) {
    if (t.status !== "todo" || !t.opportunity_id || !matchUser(t.assigned_to)) continue;
    (tasksByOpp.get(t.opportunity_id) ?? tasksByOpp.set(t.opportunity_id, []).get(t.opportunity_id)!).push(t);
  }
  for (const arr of tasksByOpp.values()) arr.sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <div>
      <PageHeader title="タスク / 次アクション" subtitle="営業活動の漏れを防ぐため、次アクションをタスクで管理します。担当で絞り込み・直近商談のフォロー漏れ確認ができます。" />

      {/* ビュー切替タブ */}
      <div className="flex items-center gap-1 border-b border-black/[0.06] mb-4">
        <TabLink href="/app/tasks" active={view === "tasks"} icon={<ListChecks size={15} />}>タスク一覧</TabLink>
        <TabLink href="/app/tasks?view=meetings" active={view === "meetings"} icon={<CalendarClock size={15} />}>私の商談とタスク一覧</TabLink>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold text-ink/50">絞り込み</span>
        <AssigneeFilter owners={owners.map((o) => ({ id: o.id, name: o.name }))} value={effAssignee} />
        {filterId && <span className="text-xs text-ink/45">{getUser(ws, filterId)?.name} を表示中</span>}
      </div>

      {view === "tasks"
        ? <TasksView ws={ws} tasks={allTasks.filter((t) => matchUser(t.assigned_to))} owners={owners} today={today} defaultAssignee={filterId || ws.ctx.userId} />
        : <MeetingsView ws={ws} oppById={oppById} tasksByOpp={tasksByOpp} owners={owners} today={today} todayJst={todayJst} matchUser={matchUser} />}
    </div>
  );
}

function TabLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
        active ? "border-teal-primary text-teal-deep" : "border-transparent text-ink/45 hover:text-ink/70"
      }`}
    >
      {icon}{children}
    </Link>
  );
}

/* ---------- タスク一覧ビュー ---------- */
function TasksView({ ws, tasks, owners, today, defaultAssignee }: { ws: Workspace; tasks: Task[]; owners: User[]; today: string; defaultAssignee: string }) {
  const open = tasks.filter((t) => t.status === "todo");
  const overdue = open.filter((t) => t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const todayTasks = open.filter((t) => t.due_date === today);
  const upcoming = open.filter((t) => t.due_date > today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <TaskGroup ws={ws} title="期限切れ" tone="rose" tasks={overdue} empty="期限切れはありません" />
        <TaskGroup ws={ws} title="今日" tone="orange" tasks={todayTasks} empty="今日のタスクはありません" />
        <TaskGroup ws={ws} title="今後の予定" tone="teal" tasks={upcoming} empty="予定タスクはありません" />
        {done.length > 0 && <TaskGroup ws={ws} title="完了" tone="gray" tasks={done} empty="" done />}
      </div>

      <Section title="タスクを追加">
        <form action={createTaskAction} className="space-y-3">
          <div><label className="label">タスク名 *</label><input name="title" required className="input" /></div>
          <div><label className="label">期限 *</label><input name="due_date" type="date" required className="input" defaultValue={today} /></div>
          <div><label className="label">担当</label>
            <select name="assigned_to" defaultValue={defaultAssignee} className="input">{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </div>
          <div><label className="label">優先度</label>
            <select name="priority" defaultValue="middle" className="input"><option value="high">高</option><option value="middle">中</option><option value="low">低</option></select>
          </div>
          <button type="submit" className="btn-primary w-full">追加する</button>
        </form>
      </Section>
    </div>
  );
}

/* ---------- 私の商談とタスク一覧ビュー ---------- */
interface MeetRow { m: MeetingRow; opp?: Opportunity; accName: string; accId?: string; effDate: string; tasks: Task[] }

async function MeetingsView({ ws, oppById, tasksByOpp, owners, today, todayJst, matchUser }: {
  ws: Workspace; oppById: Map<string, Opportunity>; tasksByOpp: Map<string, Task[]>;
  owners: User[]; today: string; todayJst: string; matchUser: (uid?: string | null) => boolean;
}) {
  // 直近の商談(RLS準拠)。担当フィルタはメモリ側で適用。
  const sb = getSupabaseServer();
  const { data: meetingRows } = await sb
    .from("meetings")
    .select("id, title, summary, meeting_date, meeting_at, owner_user_id, opportunity_id, account_id")
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .limit(200);
  const meetings = (meetingRows ?? []) as MeetingRow[];

  const rows: MeetRow[] = meetings
    .map((m): MeetRow => {
      const opp = m.opportunity_id ? oppById.get(m.opportunity_id) : undefined;
      const acc = m.account_id ? getAccount(ws, m.account_id) : opp?.account_id ? getAccount(ws, opp.account_id) : undefined;
      const effDate = m.meeting_date ?? toJstDate(m.meeting_at) ?? "";
      return { m, opp, accName: acc?.name ?? "—", accId: acc?.id ?? opp?.account_id, effDate, tasks: m.opportunity_id ? tasksByOpp.get(m.opportunity_id) ?? [] : [] };
    })
    // 担当: 商談の担当 or 案件の担当 が一致するもの
    .filter((r) => matchUser(r.m.owner_user_id) || matchUser(r.opp?.owner_user_id));

  const cmp = (a: MeetRow, b: MeetRow) => b.effDate.localeCompare(a.effDate); // 新しい順
  const future = rows.filter((r) => r.effDate && r.effDate >= todayJst).sort(cmp);
  const past = rows.filter((r) => !r.effDate || r.effDate < todayJst).sort(cmp);

  if (rows.length === 0) {
    return <p className="text-sm text-ink/40 py-10 text-center">対象の商談がありません（担当フィルタを「すべて」にすると全件表示できます）。</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-ink/40">商談後の作業漏れ・ネクストアクションのフォロー状況を確認できます。行の「＋追加」からその商談にタスクを追加できます。</p>
      <MeetingGroup label="未来分（これからの商談）" tone="teal" rows={future} ws={ws} owners={owners} today={today} defaultOpen />
      <MeetingGroup label="過去分（実施済みの商談）" tone="gray" rows={past} ws={ws} owners={owners} today={today} defaultOpen />
    </div>
  );
}

function MeetingGroup({ label, tone, rows, ws, owners, today, defaultOpen }: {
  label: string; tone: "teal" | "gray"; rows: MeetRow[]; ws: Workspace;
  owners: User[]; today: string; defaultOpen: boolean;
}) {
  const dot = tone === "teal" ? "bg-teal-primary" : "bg-ink/30";
  return (
    <details open={defaultOpen} className="rounded-2xl border border-black/[0.06] bg-white overflow-hidden">
      <summary className="cursor-pointer list-none select-none flex items-center gap-2 px-4 py-3 hover:bg-mist-soft/40">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-sm font-bold text-ink">{label}</span>
        <span className="pill bg-mist-soft text-ink/50">{rows.length}</span>
        <span className="ml-auto text-[11px] text-ink/35">クリックで開閉</span>
      </summary>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/35 px-4 py-6">該当する商談はありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-t border-black/[0.06]">
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr>
                <th className="th">日付</th>
                <th className="th">時刻</th>
                <th className="th">顧客名</th>
                <th className="th">案件名</th>
                <th className="th">商談名</th>
                <th className="th min-w-[200px]">商談概要</th>
                <th className="th min-w-[220px]">タスク</th>
                <th className="th">追加</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {rows.map((r) => <MeetingTableRow key={r.m.id} r={r} ws={ws} owners={owners} today={today} />)}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function MeetingTableRow({ r, ws, owners, today }: { r: MeetRow; ws: Workspace; owners: User[]; today: string }) {
  const { m, opp, accName, accId, tasks } = r;
  const time = formatTimeJst(m.meeting_at);
  const defaultOwner = (opp?.owner_user_id as string) || m.owner_user_id || ws.ctx.userId;
  return (
    <tr className="align-top row-hover">
      <td className="td tabular-nums text-ink/70">{formatDateFull(r.effDate || m.meeting_at)}</td>
      <td className="td tabular-nums text-ink/70">{time || "—"}</td>
      <td className="td font-medium max-w-[160px] truncate" title={accName}>{accName}</td>
      <td className="td max-w-[160px] truncate">
        {opp ? <Link href={`/app/opportunities/${opp.id}`} className="text-teal-deep hover:underline" title={opp.name}>{opp.name}</Link> : "—"}
      </td>
      <td className="td max-w-[150px] truncate">
        {m.title
          ? (m.opportunity_id ? <Link href={`/app/opportunities/${m.opportunity_id}/meetings/${m.id}`} className="hover:underline text-ink/80" title={m.title}>{m.title}</Link> : <span title={m.title}>{m.title}</span>)
          : <span className="text-ink/30">—</span>}
      </td>
      <td className="td whitespace-normal text-[12.5px] text-ink/60"><span className="line-clamp-2">{m.summary || <span className="text-ink/25">—</span>}</span></td>
      <td className="td whitespace-normal">
        {tasks.length === 0 ? (
          <span className="text-[11px] text-rose-500/80">ネクストアクション未登録</span>
        ) : (
          <div className="space-y-1">
            {tasks.map((t) => {
              const od = t.due_date < today;
              return (
                <div key={t.id} className="flex items-center gap-1.5">
                  <form action={setTaskStatusAction} className="shrink-0">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="status" value="done" />
                    <button className="text-teal-primary hover:text-teal-deep" title="完了にする">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded border-2 border-teal-primary hover:bg-teal-light"><Check size={10} /></span>
                    </button>
                  </form>
                  <span className="text-xs text-ink truncate max-w-[120px]" title={t.title}>{t.title}</span>
                  {t.priority === "high" && <Tag tone="orange">高</Tag>}
                  <span className={`text-[10px] tabular-nums shrink-0 ${od ? "text-rose-500 font-medium" : "text-ink/40"}`}>{formatDateFull(t.due_date)}</span>
                  <Avatar user={getUser(ws, t.assigned_to)} size={16} />
                </div>
              );
            })}
          </div>
        )}
      </td>
      <td className="td">
        {m.opportunity_id ? (
          <details className="relative">
            <summary className="cursor-pointer text-[11px] text-teal-deep hover:underline list-none inline-flex items-center gap-0.5"><Plus size={12} /> 追加</summary>
            <form action={createTaskAction} className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-black/10 bg-white p-2.5 shadow-lg space-y-1.5">
              <input type="hidden" name="opportunity_id" value={m.opportunity_id} />
              {accId && <input type="hidden" name="account_id" value={accId} />}
              <input name="title" required className="input py-1 text-xs" placeholder="タスク名（例：議事録送付／見積提出）" />
              <div className="grid grid-cols-2 gap-1.5">
                <input name="due_date" type="date" required defaultValue={today} className="input py-1 text-xs" />
                <select name="assigned_to" defaultValue={defaultOwner} className="input py-1 text-xs">
                  {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <select name="priority" defaultValue="middle" className="input py-1 text-xs w-20"><option value="high">高</option><option value="middle">中</option><option value="low">低</option></select>
                <button type="submit" className="rounded-lg bg-teal-primary px-3 py-1 text-xs text-white">追加する</button>
              </div>
            </form>
          </details>
        ) : <span className="text-ink/25 text-[11px]">—</span>}
      </td>
    </tr>
  );
}

function TaskGroup({ ws, title, tone, tasks, empty, done = false }: { ws: Workspace; title: string; tone: "rose" | "orange" | "teal" | "gray"; tasks: Task[]; empty: string; done?: boolean }) {
  const toneMap: Record<string, string> = {
    rose: "text-rose-500",
    orange: "text-accent-orange",
    teal: "text-teal-deep",
    gray: "text-ink/50",
  };
  return (
    <Section title="" className="overflow-hidden">
      <div className="flex items-center justify-between -mt-1 mb-3">
        <span className={`text-sm font-bold ${toneMap[tone]}`}>{title}</span>
        <span className="pill bg-mist-soft text-ink/50">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-ink/35 py-1">{empty}</p>
      ) : (
        <ul className="divide-y divide-black/[0.04]">
          {tasks.map((t) => {
            const acc = t.account_id ? getAccount(ws, t.account_id) : undefined;
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <form action={setTaskStatusAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="status" value={done ? "todo" : "done"} />
                  <button className={done ? "text-ink/30 hover:text-ink/60" : "text-teal-primary hover:text-teal-deep"} title={done ? "未完了に戻す" : "完了にする"}>
                    {done ? <RotateCcw size={18} /> : <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border-2 border-teal-primary hover:bg-teal-light"><Check size={13} /></span>}
                  </button>
                </form>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${done ? "line-through text-ink/40" : "text-ink"}`}>{t.title}</div>
                  <div className="text-xs text-ink/45">
                    {acc?.name}
                    {t.opportunity_id && <Link href={`/app/opportunities/${t.opportunity_id}`} className="text-teal-deep hover:underline ml-1">案件を見る</Link>}
                  </div>
                </div>
                {t.priority === "high" && <Tag tone="orange">高</Tag>}
                <span className="text-xs text-ink/40 shrink-0">{formatDateFull(t.due_date)}</span>
                <Avatar user={getUser(ws, t.assigned_to)} size={22} />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
