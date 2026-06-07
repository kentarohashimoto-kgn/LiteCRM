import Link from "next/link";
import { Check, RotateCcw } from "lucide-react";
import { getWorkspace, type Workspace } from "@/lib/data/workspace";
import { getAccount, getUser, listMembers, listTasks } from "@/lib/data/select";
import { PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { setTaskStatusAction, createTaskAction } from "@/server/actions";
import { formatDateFull } from "@/lib/utils";
import type { Task } from "@/lib/types";

export default async function TasksPage() {
  const ws = await getWorkspace();
  const tasks = listTasks(ws);
  const owners = listMembers(ws).map(({ user }) => user);
  const today = new Date().toISOString().slice(0, 10);

  const open = tasks.filter((t) => t.status === "todo");
  const overdue = open.filter((t) => t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const todayTasks = open.filter((t) => t.due_date === today);
  const upcoming = open.filter((t) => t.due_date > today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div>
      <PageHeader title="タスク / 次アクション" subtitle="営業活動の漏れを防ぐため、次アクションをタスクで管理します。" />

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
              <select name="assigned_to" defaultValue={ws.ctx.userId} className="input">{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </div>
            <div><label className="label">優先度</label>
              <select name="priority" defaultValue="middle" className="input"><option value="high">高</option><option value="middle">中</option><option value="low">低</option></select>
            </div>
            <button type="submit" className="btn-primary w-full">追加する</button>
          </form>
        </Section>
      </div>
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
                    {t.opportunity_id && <Link href={`/app/opportunities/${t.opportunity_id}`} className="text-teal-deep hover:underline ml-1">商談を見る</Link>}
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
