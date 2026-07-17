import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderKanban, CalendarRange } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listMembers } from "@/lib/data/select";
import { getTaskHub, getProject, sectionsOf, toTaskVM } from "@/lib/data/tasks";
import { TaskViews } from "@/components/tasks/task-views";
import { SectionManager } from "@/components/tasks/section-manager";
import { ProjectMembers } from "@/components/tasks/project-members";
import { ProgressBar } from "@/components/ui/primitives";
import { colorOf } from "@/lib/constants";
import { formatDateFull, cn } from "@/lib/utils";
import type { TaskViewKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { view?: string };
}) {
  const ws = await getWorkspaceLite();
  const hub = await getTaskHub();
  const project = getProject(hub, params.id);
  if (!project) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const sections = sectionsOf(hub, params.id).map((s) => ({ id: s.id, name: s.name }));
  const members = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name, avatarColor: user.avatarColor }));
  const projectsById = new Map(hub.projects.map((p) => [p.id, p]));

  const tasks = ws.tasks.filter((t) => t.project_id === params.id);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const vms = tasks.map((t) => toTaskVM(t, projectsById, ws.accountsById, tasksById));
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;

  const c = colorOf(project.color);
  const owner = members.find((m) => m.id === project.owner_user_id);
  const portfolio = hub.portfolios.find((pf) => pf.id === project.portfolio_id);

  // 参照権限（プロジェクトメンバー）。割当・解除は管理者のみ。
  const sb = getSupabaseServer();
  const { data: memberRows } = await sb.from("task_project_members").select("user_id").eq("project_id", params.id);
  const memberIds = new Set(((memberRows ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const projectMembers = members.filter((m) => memberIds.has(m.id));
  const isAdmin = ["owner", "admin"].includes(ws.ctx.role);

  // 依存関係（F-201）。同一プロジェクト内に限定しているため successor 側の in で十分。
  const taskIds = tasks.map((t) => t.id);
  const { data: depRows } = taskIds.length
    ? await sb.from("task_dependencies").select("id, predecessor_task_id, successor_task_id").in("successor_task_id", taskIds)
    : { data: [] };
  const deps = (depRows ?? []) as { id: string; predecessor_task_id: string; successor_task_id: string }[];

  // 次のマイルストーン（未完了で期日が近いもの。全超過なら最も期日の遅い超過分）
  const milestones = vms
    .filter((t) => t.is_milestone && t.status !== "done" && t.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
  const nextMilestone = milestones.find((t) => t.due_date! >= today) ?? milestones[milestones.length - 1] ?? null;
  const msDiff = nextMilestone ? Math.round((new Date(nextMilestone.due_date! + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000) : 0;

  const view: TaskViewKind = ["list", "board", "calendar", "timeline"].includes(searchParams.view ?? "")
    ? (searchParams.view as TaskViewKind)
    : project.default_view;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Link href="/app/tasks/projects" className="text-ink/40 hover:text-teal-deep">
          <ArrowLeft size={18} />
        </Link>
        <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg text-white", c.bg)}>
          <FolderKanban size={16} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-ink leading-tight">{project.name}</h1>
          {portfolio && (
            <Link href={`/app/tasks/portfolios/${portfolio.id}`} className="text-[11px] text-ink/45 hover:text-teal-deep">
              {portfolio.name}
            </Link>
          )}
        </div>
        <div className="ml-auto flex items-center gap-4">
          {nextMilestone && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold",
                msDiff < 0 ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700",
              )}
              title={`次のマイルストーン: ${nextMilestone.title}（${nextMilestone.due_date}）`}
            >
              <span className={cn("inline-block h-2 w-2 rotate-45", msDiff < 0 ? "bg-rose-500" : "bg-amber-500")} />
              <span className="max-w-[180px] truncate">{nextMilestone.title}</span>
              <span className="tabular-nums">{msDiff < 0 ? `${-msDiff}日超過` : msDiff === 0 ? "今日" : `残${msDiff}日`}</span>
            </span>
          )}
          {(project.start_date || project.due_date) && (
            <span className="inline-flex items-center gap-1 text-xs text-ink/45">
              <CalendarRange size={13} />
              {project.start_date ? formatDateFull(project.start_date) : "—"} 〜 {project.due_date ? formatDateFull(project.due_date) : "—"}
            </span>
          )}
          <div className="w-40">
            <div className="flex items-center justify-between text-[11px] text-ink/45 mb-1">
              <span>進捗</span>
              <span className="tabular-nums">{total > 0 ? Math.round((done / total) * 100) : 0}%</span>
            </div>
            <ProgressBar value={done} max={Math.max(total, 1)} />
          </div>
          {owner && (
            <span className="inline-flex items-center justify-center rounded-full text-white text-[11px] font-bold" style={{ width: 26, height: 26, backgroundColor: owner.avatarColor ?? "#008C8C" }} title={owner.name}>
              {owner.name.slice(0, 1)}
            </span>
          )}
        </div>
      </div>

      {project.description && <p className="text-sm text-ink/50 mb-3 max-w-3xl">{project.description}</p>}

      <div className="mb-4">
        <ProjectMembers projectId={params.id} members={projectMembers} allUsers={members} isAdmin={isAdmin} />
      </div>

      <div className="mb-4">
        <SectionManager projectId={params.id} sections={sections} />
      </div>

      <TaskViews
        initialTasks={vms}
        sections={sections}
        users={members}
        today={today}
        view={view}
        groupMode="section"
        projectId={params.id}
        currentUserId={ws.ctx.userId}
        filterMembers={projectMembers}
        allowViews={["list", "board", "calendar", "timeline"]}
        deps={deps}
      />
    </div>
  );
}
