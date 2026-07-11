import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderKanban, CalendarRange } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { getTaskHub, getProject, sectionsOf, toTaskVM } from "@/lib/data/tasks";
import { TaskViews } from "@/components/tasks/task-views";
import { SectionManager } from "@/components/tasks/section-manager";
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
  const vms = tasks.map((t) => toTaskVM(t, projectsById, ws.accountsById));
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;

  const c = colorOf(project.color);
  const owner = members.find((m) => m.id === project.owner_user_id);
  const portfolio = hub.portfolios.find((pf) => pf.id === project.portfolio_id);

  const view: TaskViewKind = ["list", "board", "calendar"].includes(searchParams.view ?? "")
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
      />
    </div>
  );
}
