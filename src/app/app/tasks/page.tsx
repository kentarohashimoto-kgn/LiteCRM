import Link from "next/link";
import { Users, User as UserIcon } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listMembers } from "@/lib/data/select";
import { getTaskHub, toTaskVM } from "@/lib/data/tasks";
import { PageHeader } from "@/components/ui/primitives";
import { TaskViews } from "@/components/tasks/task-views";
import type { TaskViewKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MyTasksPage({ searchParams }: { searchParams: { view?: string; scope?: string } }) {
  const ws = await getWorkspaceLite();
  const hub = await getTaskHub();
  const me = ws.ctx.userId;
  const today = new Date().toISOString().slice(0, 10);

  const scope = searchParams.scope === "team" ? "team" : "mine";
  const view: TaskViewKind = ["list", "board", "calendar"].includes(searchParams.view ?? "") ? (searchParams.view as TaskViewKind) : "list";

  const projectsById = new Map(hub.projects.map((p) => [p.id, p]));
  const members = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name, avatarColor: user.avatarColor }));

  // サブタスクも自分担当なら表示する（親が他人担当でも自分の作業として見える）
  const tasksById = new Map(ws.tasks.map((t) => [t.id, t]));
  const filtered = ws.tasks.filter((t) => (scope === "mine" ? t.assigned_to === me : true));
  const vms = filtered.map((t) => toTaskVM(t, projectsById, ws.accountsById, tasksById));

  // コメント数（F-203。💬バッジ用）
  const taskIds = filtered.map((t) => t.id);
  const sb = getSupabaseServer();
  const { data: commentRows } = taskIds.length
    ? await sb.from("task_comments").select("task_id").in("task_id", taskIds)
    : { data: [] };
  const commentCounts: Record<string, number> = {};
  for (const r of (commentRows ?? []) as { task_id: string }[]) commentCounts[r.task_id] = (commentCounts[r.task_id] ?? 0) + 1;
  const isAdmin = ["owner", "admin"].includes(ws.ctx.role);

  return (
    <div>
      <PageHeader
        title="マイタスク"
        subtitle="担当・期日でひとまとめ。チェックすると完了。リスト / ボード / カレンダーで切り替えられます。"
        action={<ScopeToggle scope={scope} view={view} />}
      />
      <TaskViews
        initialTasks={vms}
        sections={[]}
        users={members}
        today={today}
        view={view}
        groupMode="date"
        currentUserId={me}
        commentCounts={commentCounts}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function ScopeToggle({ scope, view }: { scope: string; view: string }) {
  const base = "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors";
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-mist-soft p-1">
      <Link href={`/app/tasks?scope=mine&view=${view}`} className={cn(base, scope === "mine" ? "bg-white text-teal-deep shadow-sm" : "text-ink/50 hover:text-ink/80")}>
        <UserIcon size={15} /> マイタスク
      </Link>
      <Link href={`/app/tasks?scope=team&view=${view}`} className={cn(base, scope === "team" ? "bg-white text-teal-deep shadow-sm" : "text-ink/50 hover:text-ink/80")}>
        <Users size={15} /> チーム全体
      </Link>
    </div>
  );
}
