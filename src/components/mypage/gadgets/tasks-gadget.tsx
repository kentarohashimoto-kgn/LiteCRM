import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { Card, LinkButton, Section } from "@/components/ui/primitives";
import { getSupabaseServer } from "@/lib/supabase/server";
import { cn, formatDate } from "@/lib/utils";
import type { Priority } from "@/lib/types";

interface TaskRow {
  id: string;
  title: string;
  priority: Priority | null;
  due_date: string | null;
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-rose-500",
  middle: "bg-amber-400",
  low: "bg-slate-300",
};

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function TaskColumn({ title, tone, tasks }: { title: string; tone: "rose" | "teal" | "sky" | "slate"; tasks: TaskRow[] }) {
  const toneCls = {
    rose: "text-rose-600 bg-rose-50 border-rose-200",
    teal: "text-teal-700 bg-teal-50 border-teal-200",
    sky: "text-sky-700 bg-sky-50 border-sky-200",
    slate: "text-slate-500 bg-slate-50 border-slate-200",
  }[tone];
  return (
    <div className="min-w-0">
      <div className={cn("rounded-md border px-2 py-1 text-xs font-semibold flex items-center justify-between", toneCls)}>
        <span>{title}</span>
        <span>{tasks.length}</span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        {tasks.length === 0 && <p className="text-[11px] text-slate-300 px-1">なし</p>}
        {tasks.slice(0, 6).map((t) => (
          <Link key={t.id} href="/app/tasks" className="block rounded-md border border-slate-200 bg-white px-2 py-1.5 hover:border-teal-400 transition-colors">
            <span className="flex items-start gap-1.5">
              <span className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0", PRIORITY_DOT[t.priority ?? "low"] ?? "bg-slate-300")} />
              <span className="min-w-0">
                <span className="block text-xs text-slate-700 leading-snug line-clamp-2">{t.title}</span>
                {t.due_date && <span className="block text-[10px] text-slate-400">{formatDate(t.due_date)}</span>}
              </span>
            </span>
          </Link>
        ))}
        {tasks.length > 6 && <p className="text-[11px] text-slate-400 px-1">ほか{tasks.length - 6}件</p>}
      </div>
    </div>
  );
}

/** タスクカンバンガジェット: 自分のタスク(未完了)を期限別に4列で表示。 */
export async function TasksGadget({ userId }: { userId: string }) {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("tasks")
    .select("id,title,priority,due_date,status")
    .eq("assigned_to", userId)
    .in("status", ["todo", "overdue"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(80);
  const tasks = (data ?? []) as (TaskRow & { status: string })[];

  const today = jstToday();
  const weekEnd = new Date(Date.now() + 9 * 3600 * 1000);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - weekEnd.getUTCDay()));
  const weekEndKey = weekEnd.toISOString().slice(0, 10);

  const overdue = tasks.filter((t) => t.due_date && t.due_date < today);
  const todays = tasks.filter((t) => t.due_date === today);
  const thisWeek = tasks.filter((t) => t.due_date && t.due_date > today && t.due_date <= weekEndKey);
  const later = tasks.filter((t) => !t.due_date || t.due_date > weekEndKey);

  return (
    <Section
      title="タスク"
      icon={<CheckSquare size={16} />}
      action={<LinkButton href="/app/tasks" variant="ghost">タスクへ</LinkButton>}
    >
      <Card className="p-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TaskColumn title="期限超過" tone="rose" tasks={overdue} />
          <TaskColumn title="今日" tone="teal" tasks={todays} />
          <TaskColumn title="今週" tone="sky" tasks={thisWeek} />
          <TaskColumn title="来週以降・期限なし" tone="slate" tasks={later} />
        </div>
      </Card>
    </Section>
  );
}
