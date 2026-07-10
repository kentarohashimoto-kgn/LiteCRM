import { BarChart3, CheckCircle2, CircleAlert, ListTodo, TrendingUp } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { getTaskHub } from "@/lib/data/tasks";
import { PageHeader, ProgressBar } from "@/components/ui/primitives";
import { WeeklyChart, AssigneeChart, type WeeklyPoint, type AssigneePoint } from "@/components/tasks/report-charts";
import { colorOf } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** 週の月曜(YYYY-MM-DD)を返す。 */
function monday(d: Date): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return x.toISOString().slice(0, 10);
}

export default async function ReportsPage() {
  const ws = await getWorkspaceLite();
  const hub = await getTaskHub();
  const members = listMembers(ws).map(({ user }) => user);
  const today = new Date().toISOString().slice(0, 10);

  const tasks = ws.tasks;
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const open = total - done;
  const overdue = tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date < today).length;
  const rate = total > 0 ? Math.round((done / total) * 100) : 0;

  // 直近8週の完了/作成
  const now = new Date();
  const weeks: { key: string; label: string }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const key = monday(d);
    weeks.push({ key, label: `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}` });
  }
  const weekIndex = new Map(weeks.map((w, i) => [w.key, i]));
  const weekly: WeeklyPoint[] = weeks.map((w) => ({ label: w.label, completed: 0, created: 0 }));
  for (const t of tasks) {
    if (t.completed_at) {
      const k = monday(new Date(t.completed_at));
      const i = weekIndex.get(k);
      if (i != null) weekly[i].completed += 1;
    }
  }
  // 作成日は workspace_lite に created_at が含まれないため、期日ベースで近似（作成推移の目安）。
  for (const t of tasks) {
    if (t.due_date) {
      const k = monday(new Date(t.due_date + "T00:00:00"));
      const i = weekIndex.get(k);
      if (i != null) weekly[i].created += 1;
    }
  }

  // 担当別
  const byAssignee: AssigneePoint[] = members
    .map((m) => {
      const mine = tasks.filter((t) => t.assigned_to === m.id);
      return { label: m.name.length > 5 ? m.name.slice(0, 5) : m.name, open: mine.filter((t) => t.status !== "done").length, done: mine.filter((t) => t.status === "done").length };
    })
    .filter((a) => a.open + a.done > 0)
    .sort((a, b) => b.open + b.done - (a.open + a.done))
    .slice(0, 10);

  // プロジェクト別進捗
  const projStats = hub.projects
    .filter((p) => p.status !== "archived")
    .map((p) => {
      const mine = tasks.filter((t) => t.project_id === p.id);
      const d = mine.filter((t) => t.status === "done").length;
      return { p, done: d, total: mine.length };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <div>
      <PageHeader title="レポート" subtitle="タスクの消化状況・担当別の負荷・プロジェクト進捗をひと目で。" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Tile icon={<ListTodo size={18} />} label="未完了タスク" value={open} tone="teal" />
        <Tile icon={<CheckCircle2 size={18} />} label="完了" value={done} tone="teal" />
        <Tile icon={<CircleAlert size={18} />} label="期限切れ" value={overdue} tone="rose" />
        <Tile icon={<TrendingUp size={18} />} label="完了率" value={`${rate}%`} tone="orange" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-black/[0.04]">
            <h2 className="section-title"><BarChart3 size={15} /> 週次の消化（完了 / 期日到来）</h2>
          </div>
          <div className="p-4">
            <WeeklyChart data={weekly} />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-black/[0.04]">
            <h2 className="section-title"><BarChart3 size={15} /> 担当別の負荷</h2>
          </div>
          <div className="p-4">
            {byAssignee.length > 0 ? <AssigneeChart data={byAssignee} /> : <p className="text-sm text-ink/40 py-10 text-center">データがありません</p>}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden mt-5">
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-black/[0.04]">
          <h2 className="section-title"><BarChart3 size={15} /> プロジェクト別 進捗</h2>
        </div>
        {projStats.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink/40 text-center">プロジェクトに紐づくタスクがありません。</p>
        ) : (
          <div className="p-4 space-y-3">
            {projStats.map(({ p, done: d, total: tot }) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", colorOf(p.color).dot)} />
                <span className="w-40 shrink-0 text-sm text-ink/80 truncate">{p.name}</span>
                <div className="flex-1"><ProgressBar value={d} max={Math.max(tot, 1)} /></div>
                <span className="w-24 text-right text-[11px] tabular-nums text-ink/50">{Math.round((d / tot) * 100)}%（{d}/{tot}）</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone: "teal" | "rose" | "orange" }) {
  const toneCls = tone === "rose" ? "bg-rose-50 text-rose-600" : tone === "orange" ? "bg-orange-50 text-orange-600" : "bg-teal-light text-teal-deep";
  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", toneCls)}>{icon}</span>
        <span className="text-xs font-semibold text-ink/50">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}
