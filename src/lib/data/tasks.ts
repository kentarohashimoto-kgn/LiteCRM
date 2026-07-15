import { cache } from "react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import type { Account, Goal, Task, TaskPortfolio, TaskProject, TaskSection } from "@/lib/types";
import type { TaskVM } from "@/components/tasks/vm";

/**
 * Asana型タスク機能の付随エンティティ（プロジェクト/セクション/ポートフォリオ/ゴール）。
 * workspace RPC には含めず、専用の軽量クエリで取得する。
 * マイグレーション未適用の環境でもアプリが落ちないよう、エラー時は空配列で継続する。
 */
export interface TaskHub {
  projects: TaskProject[];
  sections: TaskSection[];
  portfolios: TaskPortfolio[];
  goals: Goal[];
}

const bySort = <T extends { sort_order?: number; created_at?: string; name?: string }>(a: T, b: T) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
  (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
  (a.name ?? "").localeCompare(b.name ?? "");

export const getTaskHub = cache(async (): Promise<TaskHub> => {
  await requireCtx();
  const sb = getSupabaseServer();

  const [projR, secR, portR, goalR] = await Promise.all([
    sb.from("task_projects").select("*"),
    sb.from("task_sections").select("*"),
    sb.from("task_portfolios").select("*"),
    sb.from("goals").select("*"),
  ]);

  const projects = ((projR.data ?? []) as TaskProject[]).sort(bySort);
  const sections = ((secR.data ?? []) as TaskSection[]).sort(bySort);
  const portfolios = ((portR.data ?? []) as TaskPortfolio[]).sort(bySort);
  const goals = ((goalR.data ?? []) as Goal[]).sort(bySort);

  return { projects, sections, portfolios, goals };
});

export function getProject(hub: TaskHub, id: string): TaskProject | undefined {
  return hub.projects.find((p) => p.id === id);
}

export function sectionsOf(hub: TaskHub, projectId: string): TaskSection[] {
  return hub.sections.filter((s) => s.project_id === projectId).sort(bySort);
}

export function projectsOf(hub: TaskHub, portfolioId: string): TaskProject[] {
  return hub.projects.filter((p) => p.portfolio_id === portfolioId).sort(bySort);
}

/** Task 行を TaskVM（クライアント境界用）へ変換する。 */
export function toTaskVM(
  t: Task,
  projectsById: Map<string, TaskProject>,
  accountsById: Map<string, Account>,
): TaskVM {
  const proj = t.project_id ? projectsById.get(t.project_id) : undefined;
  const acc = t.account_id ? accountsById.get(t.account_id) : undefined;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority ?? null,
    due_date: t.due_date ?? null,
    start_date: t.start_date ?? null,
    assigned_to: t.assigned_to ?? null,
    section_id: t.section_id ?? null,
    project_id: t.project_id ?? null,
    opportunity_id: t.opportunity_id ?? null,
    sort_order: t.sort_order ?? 0,
    projectName: proj?.name ?? null,
    projectColor: proj?.color ?? null,
    accountName: acc?.name ?? null,
    labels: t.labels ?? [],
    color: t.color ?? null,
    description: t.description ?? null,
    url: t.url ?? null,
  };
}
