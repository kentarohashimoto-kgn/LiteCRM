"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ColorKey, GoalStatus, TaskViewKind } from "@/lib/types";

/* ---------------------------------------------------------------------
 * Asana型タスク機能のサーバーアクション。
 *  - フォーム系（プロジェクト/ポートフォリオ/ゴール作成）は FormData を受ける。
 *  - ボード/リストの対話操作（完了トグル・移動・並び替え）は型付き引数を受ける。
 * ------------------------------------------------------------------- */

function s(v: FormDataEntryValue | null): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}
function n(v: FormDataEntryValue | null): number | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (t === "") return null;
  const x = Number(t.replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : null;
}

function touch() {
  // タスク領域はすべて動的描画。まとめて再検証する。
  revalidatePath("/app/tasks", "layout");
}

/* ========================= プロジェクト ========================= */

export async function createProjectAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const name = s(formData.get("name"));
  if (!name) return;
  const view = (s(formData.get("default_view")) ?? "board") as TaskViewKind;
  const { data } = await sb
    .from("task_projects")
    .insert({
      tenant_id: ctx.tenantId,
      name,
      description: s(formData.get("description")),
      color: (s(formData.get("color")) ?? "teal") as ColorKey,
      portfolio_id: s(formData.get("portfolio_id")),
      owner_user_id: s(formData.get("owner_user_id")) ?? ctx.userId,
      due_date: s(formData.get("due_date")),
      default_view: view,
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();

  const id = (data as { id: string } | null)?.id;
  if (!id) {
    touch();
    return;
  }
  // 既定セクションを2つ用意（Asanaの初期体験に近づける）。
  await sb.from("task_sections").insert([
    { tenant_id: ctx.tenantId, project_id: id, name: "To Do", sort_order: 0 },
    { tenant_id: ctx.tenantId, project_id: id, name: "進行中", sort_order: 1 },
    { tenant_id: ctx.tenantId, project_id: id, name: "完了", sort_order: 2 },
  ]);
  touch();
  redirect(`/app/tasks/projects/${id}`);
}

export async function updateProjectAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = s(formData.get("id"));
  if (!id) return;
  const patch: Record<string, unknown> = {};
  const name = s(formData.get("name"));
  if (name) patch.name = name;
  if (formData.has("description")) patch.description = s(formData.get("description"));
  if (formData.has("color")) patch.color = s(formData.get("color"));
  if (formData.has("owner_user_id")) patch.owner_user_id = s(formData.get("owner_user_id"));
  if (formData.has("portfolio_id")) patch.portfolio_id = s(formData.get("portfolio_id"));
  if (formData.has("due_date")) patch.due_date = s(formData.get("due_date"));
  await sb.from("task_projects").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
}

export async function setProjectViewAction(id: string, view: TaskViewKind) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("task_projects").update({ default_view: view }).eq("id", id).eq("tenant_id", ctx.tenantId);
}

export async function archiveProjectAction(id: string, archived: boolean) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb
    .from("task_projects")
    .update({ status: archived ? "archived" : "active" })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  touch();
}

export async function deleteProjectAction(id: string) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  // タスクは孤児化せずプロジェクトから外す（on delete set null）。
  await sb.from("task_projects").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
  redirect("/app/tasks/projects");
}

/* ========================= セクション ========================= */

export async function createSectionAction(projectId: string, name: string) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const nm = name.trim();
  if (!nm) return;
  const { count } = await sb
    .from("task_sections")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  await sb.from("task_sections").insert({
    tenant_id: ctx.tenantId,
    project_id: projectId,
    name: nm,
    sort_order: count ?? 0,
  });
  touch();
}

export async function renameSectionAction(id: string, name: string) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const nm = name.trim();
  if (!nm) return;
  await sb.from("task_sections").update({ name: nm }).eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
}

export async function deleteSectionAction(id: string) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  // 配下タスクはセクション未設定へ（プロジェクト内には残る）。
  await sb.from("tasks").update({ section_id: null }).eq("section_id", id);
  await sb.from("task_sections").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
}

/* ========================= タスク ========================= */

export interface TaskInput {
  title: string;
  project_id?: string | null;
  section_id?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  priority?: string | null;
  description?: string | null;
  opportunity_id?: string | null;
  account_id?: string | null;
}

export async function createProjectTaskAction(input: TaskInput) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const title = input.title.trim();
  if (!title) return;
  let sort = 0;
  if (input.section_id) {
    const { count } = await sb
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("section_id", input.section_id);
    sort = count ?? 0;
  }
  await sb.from("tasks").insert({
    tenant_id: ctx.tenantId,
    title,
    project_id: input.project_id ?? null,
    section_id: input.section_id ?? null,
    assigned_to: input.assigned_to ?? ctx.userId,
    created_by: ctx.userId,
    due_date: input.due_date ?? null,
    start_date: input.start_date ?? null,
    priority: input.priority ?? "middle",
    description: input.description ?? null,
    opportunity_id: input.opportunity_id ?? null,
    account_id: input.account_id ?? null,
    status: "todo",
    sort_order: sort,
  });
  touch();
}

export async function updateTaskAction(id: string, patch: Partial<TaskInput>) {
  await requireCtx();
  const sb = getSupabaseServer();
  const p: Record<string, unknown> = {};
  if (patch.title !== undefined) p.title = patch.title;
  if (patch.assigned_to !== undefined) p.assigned_to = patch.assigned_to;
  if (patch.due_date !== undefined) p.due_date = patch.due_date;
  if (patch.start_date !== undefined) p.start_date = patch.start_date;
  if (patch.priority !== undefined) p.priority = patch.priority;
  if (patch.description !== undefined) p.description = patch.description;
  if (patch.project_id !== undefined) p.project_id = patch.project_id;
  if (patch.section_id !== undefined) p.section_id = patch.section_id;
  if (Object.keys(p).length === 0) return;
  await sb.from("tasks").update(p).eq("id", id);
  touch();
}

export async function toggleTaskDoneAction(id: string, done: boolean) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb
    .from("tasks")
    .update({ status: done ? "done" : "todo", completed_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  touch();
}

/** ボード/リストのドラッグ移動。section_id と並び順を更新する。 */
export async function moveTaskAction(id: string, sectionId: string | null, sortOrder: number, projectId?: string | null) {
  await requireCtx();
  const sb = getSupabaseServer();
  const patch: Record<string, unknown> = { section_id: sectionId, sort_order: sortOrder };
  if (projectId !== undefined) patch.project_id = projectId;
  await sb.from("tasks").update(patch).eq("id", id);
  touch();
}

export async function deleteTaskAction(id: string) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("tasks").delete().eq("id", id);
  touch();
}

/**
 * 目的セクションの並びを確定する。移動タスクを含む順序どおりに
 * section_id と sort_order を一括更新する（ドラッグ＆ドロップ後の永続化）。
 */
export async function reorderTasksAction(sectionId: string | null, orderedIds: string[]) {
  await requireCtx();
  const sb = getSupabaseServer();
  await Promise.all(
    orderedIds.map((id, i) =>
      sb.from("tasks").update({ section_id: sectionId, sort_order: i }).eq("id", id),
    ),
  );
  touch();
}

/* ========================= ポートフォリオ ========================= */

export async function createPortfolioAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const name = s(formData.get("name"));
  if (!name) return;
  const { data } = await sb
    .from("task_portfolios")
    .insert({
      tenant_id: ctx.tenantId,
      name,
      description: s(formData.get("description")),
      color: (s(formData.get("color")) ?? "violet") as ColorKey,
      owner_user_id: s(formData.get("owner_user_id")) ?? ctx.userId,
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  touch();
  const id = (data as { id: string } | null)?.id;
  if (id) redirect(`/app/tasks/portfolios/${id}`);
}

export async function updatePortfolioAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = s(formData.get("id"));
  if (!id) return;
  const patch: Record<string, unknown> = {};
  const name = s(formData.get("name"));
  if (name) patch.name = name;
  if (formData.has("description")) patch.description = s(formData.get("description"));
  if (formData.has("color")) patch.color = s(formData.get("color"));
  await sb.from("task_portfolios").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
}

export async function setProjectPortfolioAction(projectId: string, portfolioId: string | null) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("task_projects").update({ portfolio_id: portfolioId }).eq("id", projectId).eq("tenant_id", ctx.tenantId);
  touch();
}

export async function deletePortfolioAction(id: string) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("task_portfolios").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
  redirect("/app/tasks/portfolios");
}

/* ========================= ゴール ========================= */

export async function createGoalAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const name = s(formData.get("name"));
  if (!name) return;
  await sb.from("goals").insert({
    tenant_id: ctx.tenantId,
    name,
    description: s(formData.get("description")),
    owner_user_id: s(formData.get("owner_user_id")) ?? ctx.userId,
    parent_goal_id: s(formData.get("parent_goal_id")),
    portfolio_id: s(formData.get("portfolio_id")),
    project_id: s(formData.get("project_id")),
    metric_kind: s(formData.get("metric_kind")) ?? "number",
    target_value: n(formData.get("target_value")),
    current_value: n(formData.get("current_value")) ?? 0,
    unit: s(formData.get("unit")),
    status: (s(formData.get("status")) ?? "on_track") as GoalStatus,
    period_start: s(formData.get("period_start")),
    period_end: s(formData.get("period_end")),
    created_by: ctx.userId,
  });
  touch();
}

export async function updateGoalProgressAction(id: string, currentValue: number, status?: GoalStatus) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const patch: Record<string, unknown> = { current_value: currentValue };
  if (status) patch.status = status;
  await sb.from("goals").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
}

export async function setGoalStatusAction(id: string, status: GoalStatus) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("goals").update({ status }).eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
}

export async function deleteGoalAction(id: string) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("goals").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  touch();
}
