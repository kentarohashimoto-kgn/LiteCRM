import Link from "next/link";
import { Check, RotateCcw, Plus, MessagesSquare } from "lucide-react";
import { getWorkspaceLite, type Workspace } from "@/lib/data/workspace";
import { getAccount, getUser, listMembers, listTasks } from "@/lib/data/select";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { setTaskStatusAction, createTaskAction } from "@/server/actions";
import { AssigneeFilter } from "@/components/tasks/assignee-filter";
import { formatDateFull } from "@/lib/utils";
import type { Task, Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

interface MeetingRow {
  id: string; title: string | null; summary: string | null;
  meeting_date: string | null; meeting_at: string | null;
  opportunity_id: string | null; account_id: string | null;
}

export default async function TasksPage({ searchParams }: { searchParams: { assignee?: string } }) {
  const ws = await getWorkspaceLite();
  const allTasks = listTasks(ws);
  const owners = listMembers(ws).map(({ user }) => user);
  const today = new Date().toISOString().slice(0, 10);

  // 担当別フィルタ(?assignee=)。メンバーに存在するIDのみ有効。
  const assignee = owners.some((o) => o.id === searchParams.assignee) ? (searchParams.assignee as string) : "";
  const matchAssignee = (t: Task) => !assignee || t.assigned_to === assignee;
  const tasks = allTasks.filter(matchAssignee);

  const open = tasks.filter((t) => t.status === "todo");
  const overdue = open.filter((t) => t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const todayTasks = open.filter((t) => t.due_date === today);
  const upcoming = open.filter((t) => t.due_date > today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const done = tasks.filter((t) => t.status === "done");

  // 直近の商談(RLS準拠・最近発生順)。案件・顧客はワークスペースから解決。
  const sb = getSupabaseServer();
  const { data: meetingRows } = await sb
    .from("meetings")
    .select("id, title, summary, meeting_date, meeting_at, opportunity_id, account_id")
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .limit(20);
  const meetings = (meetingRows ?? []) as MeetingRow[];

  const oppById = new Map<string, Opportunity>(ws.opportunities.map((o) => [o.id, o]));
  // 案件ごとの未完了タスク(担当フィルタ適用)
  const tasksByOpp = new Map<string, Task[]>();
  for (const t of allTasks) {
    if (t.status !== "todo" || !t.opportunity_id || !matchAssignee(t)) continue;
    (tasksByOpp.get(t.opportunity_id) ?? tasksByOpp.set(t.opportunity_id, []).get(t.opportunity_id)!).push(t);
  }
  for (const arr of tasksByOpp.values()) arr.sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <div>
      <PageHeader title="タスク / 次アクション" subtitle="営業活動の漏れを防ぐため、次アクションをタスクで管理します。担当で絞り込み・直近商談のフォロー漏れ確認ができます。" />

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold text-ink/50">絞り込み</span>
        <AssigneeFilter owners={owners.map((o) => ({ id: o.id, name: o.name }))} value={assignee} />
        {assignee && <span className="text-xs text-ink/45">{getUser(ws, assignee)?.name} のタスクを表示中</span>}
      </div>

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
              <select name="assigned_to" defaultValue={assignee || ws.ctx.userId} className="input">{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </div>
            <div><label className="label">優先度</label>
              <select name="priority" defaultValue="middle" className="input"><option value="high">高</option><option value="middle">中</option><option value="low">低</option></select>
            </div>
            <button type="submit" className="btn-primary w-full">追加する</button>
          </form>
        </Section>
      </div>

      {/* 直近の商談とフォロータスク */}
      <Section title="直近の商談とフォロータスク" className="mt-5" action={<span className="text-[11px] text-ink/40">商談後の作業漏れ・ネクストアクションを確認</span>}>
        {meetings.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">商談の記録がまだありません</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {meetings.map((m) => {
              const opp = m.opportunity_id ? oppById.get(m.opportunity_id) : undefined;
              const acc = m.account_id ? getAccount(ws, m.account_id) : (opp?.account_id ? getAccount(ws, opp.account_id) : undefined);
              const followTasks = m.opportunity_id ? (tasksByOpp.get(m.opportunity_id) ?? []) : [];
              const defaultOwner = (opp?.owner_user_id as string) || ws.ctx.userId;
              return (
                <div key={m.id} className="rounded-xl border border-black/[0.06] p-3">
                  <div className="flex items-start gap-2">
                    <MessagesSquare size={15} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink truncate">{acc?.name ?? "—"}</span>
                        <span className="text-[11px] text-ink/40 tabular-nums shrink-0">{formatDateFull(m.meeting_date ?? m.meeting_at)}</span>
                      </div>
                      <div className="text-xs text-ink/55">
                        {opp && <Link href={`/app/opportunities/${opp.id}`} className="text-teal-deep hover:underline">{opp.name}</Link>}
                        {opp && m.title && <span className="text-ink/30"> ／ </span>}
                        {m.title && (m.opportunity_id ? <Link href={`/app/opportunities/${m.opportunity_id}/meetings/${m.id}`} className="hover:underline">{m.title}</Link> : m.title)}
                      </div>
                      {m.summary && <p className="text-[11.5px] text-ink/60 mt-1 line-clamp-2">{m.summary}</p>}
                    </div>
                  </div>

                  {/* フォロータスク */}
                  <div className="mt-2.5 pl-1 space-y-1">
                    {followTasks.length === 0 ? (
                      <p className="text-[11px] text-rose-500/80">ネクストアクションのタスク未登録 — 追加を推奨</p>
                    ) : (
                      followTasks.map((t) => {
                        const overdueFlag = t.due_date < today;
                        return (
                          <div key={t.id} className="flex items-center gap-2">
                            <form action={setTaskStatusAction}>
                              <input type="hidden" name="id" value={t.id} />
                              <input type="hidden" name="status" value="done" />
                              <button className="text-teal-primary hover:text-teal-deep" title="完了にする">
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded border-2 border-teal-primary hover:bg-teal-light"><Check size={10} /></span>
                              </button>
                            </form>
                            <span className="text-xs text-ink truncate flex-1">{t.title}</span>
                            {t.priority === "high" && <Tag tone="orange">高</Tag>}
                            <span className={`text-[11px] tabular-nums shrink-0 ${overdueFlag ? "text-rose-500 font-medium" : "text-ink/40"}`}>{formatDateFull(t.due_date)}</span>
                            <Avatar user={getUser(ws, t.assigned_to)} size={18} />
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* この商談(案件)にタスクを追加 */}
                  {m.opportunity_id && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-teal-deep hover:underline list-none inline-flex items-center gap-0.5"><Plus size={12} /> この商談にタスクを追加</summary>
                      <form action={createTaskAction} className="mt-2 rounded-lg border border-black/[0.06] bg-mist-soft/30 p-2 space-y-1.5">
                        <input type="hidden" name="opportunity_id" value={m.opportunity_id} />
                        {(acc?.id || opp?.account_id) && <input type="hidden" name="account_id" value={acc?.id ?? opp?.account_id ?? ""} />}
                        <input name="title" required className="input py-1 text-xs" placeholder="タスク名（例：議事録を送付／見積提出）" />
                        <div className="grid grid-cols-2 gap-1.5">
                          <input name="due_date" type="date" required defaultValue={today} className="input py-1 text-xs" />
                          <select name="assigned_to" defaultValue={defaultOwner} className="input py-1 text-xs">
                            {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <select name="priority" defaultValue="middle" className="input py-1 text-xs w-24"><option value="high">高</option><option value="middle">中</option><option value="low">低</option></select>
                          <button type="submit" className="rounded-lg bg-teal-primary px-3 py-1 text-xs text-white">追加</button>
                        </div>
                      </form>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
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
