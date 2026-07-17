"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export interface OppComment {
  id: string;
  author_user_id: string;
  body: string;
  mentions: string[];
  created_at: string;
}

/** C-2 案件コメントを投稿。メンションがあればSlackへ通知(A-1連動、未設定なら送らない)。 */
export async function addOppCommentAction(input: {
  opportunityId: string;
  body: string;
  mentions: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "コメントが空です" };
  const mentions = (input.mentions ?? []).slice(0, 20);

  const { error } = await sb.from("opportunity_comments").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: input.opportunityId,
    author_user_id: ctx.userId,
    body,
    mentions,
  });
  if (error) return { ok: false, error: error.message };

  // メンション通知: アプリ内ベル(A-1)＋Slack(設定時)。失敗しても投稿は成立させる
  if (mentions.length > 0) {
    try {
      const [{ data: opp }, { data: profs }] = await Promise.all([
        sb.from("opportunities").select("name, accounts(name)").eq("id", input.opportunityId).maybeSingle(),
        sb.from("profiles").select("id, display_name, email").in("id", [...mentions, ctx.userId]),
      ]);
      const nameOf = new Map((profs ?? []).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || "—"]));
      const oppRow = opp as { name?: string; accounts?: { name?: string } | null } | null;
      const oppLabel = [oppRow?.accounts?.name, oppRow?.name].filter(Boolean).join("｜") || "案件";
      const authorName = nameOf.get(ctx.userId) ?? ctx.email;
      const href = `/app/opportunities/${input.opportunityId}`;

      // アプリ内通知(自分宛は除外)
      const targets = mentions.filter((m) => m !== ctx.userId);
      if (targets.length > 0) {
        await sb.from("notifications").insert(
          targets.map((userId) => ({
            tenant_id: ctx.tenantId,
            user_id: userId,
            kind: "mention",
            title: `${authorName}さんがコメントであなたをメンション`,
            body: `${oppLabel}\n${body.slice(0, 120)}`,
            href,
          })),
        );
      }

      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://lite-crm-tau.vercel.app"}${href}`;
        const to = mentions.map((m) => nameOf.get(m) ?? "—").join(" ");
        const text = `:speech_balloon: *${authorName}* さんが *${to}* さんをメンションしました\n<${url}|${oppLabel}>\n> ${body.slice(0, 300)}`;
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      }
    } catch {
      /* 通知失敗は無視 */
    }
  }

  revalidatePath(`/app/opportunities/${input.opportunityId}`);
  return { ok: true };
}

/** コメント削除(本人 or 管理者。権限はRLSが担保)。 */
export async function deleteOppCommentAction(input: { id: string; opportunityId: string }): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("opportunity_comments").delete().eq("id", input.id);
  revalidatePath(`/app/opportunities/${input.opportunityId}`);
  return { ok: true };
}

/* ===================== リードコメント（展示会ドリルダウン用） ===================== */

export interface LeadComment {
  id: string;
  author_user_id: string;
  body: string;
  mentions: string[];
  created_at: string;
}

/** 未商談リード等に社内コメントを投稿。展示会別ドリルダウンからアプローチ状況を追記する。 */
export async function addLeadCommentAction(input: { leadId: string; body: string }): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "コメントが空です" };
  const { error } = await sb.from("lead_comments").insert({
    tenant_id: ctx.tenantId,
    lead_id: input.leadId,
    author_user_id: ctx.userId,
    body,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/analytics/exhibitions", "layout");
  revalidatePath(`/app/leads/${input.leadId}`);
  return { ok: true };
}

/** リードコメント削除（本人 or 管理者。権限はRLSが担保）。 */
export async function deleteLeadCommentAction(input: { id: string }): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("lead_comments").delete().eq("id", input.id);
  revalidatePath("/app/analytics/exhibitions", "layout");
  return { ok: true };
}

/* ===================== タスクコメント（F-203） ===================== */

export interface TaskCommentView {
  id: string;
  author_user_id: string;
  authorName: string;
  body: string;
  mentions: string[];
  created_at: string;
}

/** タスクの詳細パネルを開いたときに読み込むコメント一覧（投稿者名を解決）。 */
export async function listTaskCommentsAction(taskId: string): Promise<TaskCommentView[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("task_comments")
    .select("id, author_user_id, body, mentions, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as Omit<TaskCommentView, "authorName">[];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.author_user_id)));
  const { data: profs } = await sb.from("profiles").select("id, display_name, email").in("id", ids);
  const nameOf = new Map((profs ?? []).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || "—"]));
  return rows.map((r) => ({ ...r, authorName: nameOf.get(r.author_user_id) ?? "—" }));
}

/**
 * F-203 タスクにコメントを投稿。メンション相手＋担当者へアプリ内ベル＋Slack通知。
 * 案件コメント(C-2 addOppCommentAction)と同じ通知動線に揃える。
 */
export async function addTaskCommentAction(input: {
  taskId: string;
  body: string;
  mentions: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "コメントが空です" };
  const mentions = Array.from(new Set(input.mentions ?? [])).slice(0, 20);

  const { error } = await sb.from("task_comments").insert({
    tenant_id: ctx.tenantId,
    task_id: input.taskId,
    author_user_id: ctx.userId,
    body,
    mentions,
  });
  if (error) return { ok: false, error: error.message };

  // 通知先: メンション相手＋タスク担当者（投稿者本人は除外）。失敗しても投稿は成立させる。
  try {
    const [{ data: task }, { data: profs }] = await Promise.all([
      sb.from("tasks").select("title, project_id, assigned_to, task_projects(name)").eq("id", input.taskId).maybeSingle(),
      sb.from("profiles").select("id, display_name, email"),
    ]);
    const nameOf = new Map((profs ?? []).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || "—"]));
    const taskRow = task as { title?: string; project_id?: string | null; assigned_to?: string | null; task_projects?: { name?: string } | null } | null;
    const projectName = taskRow?.task_projects?.name;
    const taskLabel = [projectName, taskRow?.title].filter(Boolean).join("｜") || "タスク";
    const authorName = nameOf.get(ctx.userId) ?? ctx.email;
    const href = taskRow?.project_id ? `/app/tasks/projects/${taskRow.project_id}?task=${input.taskId}` : `/app/tasks?task=${input.taskId}`;

    // メンション相手＋担当者。重複と投稿者本人は除く。
    const recipients = new Set<string>(mentions);
    if (taskRow?.assigned_to) recipients.add(taskRow.assigned_to);
    recipients.delete(ctx.userId);
    const targets = Array.from(recipients);

    if (targets.length > 0) {
      await sb.from("notifications").insert(
        targets.map((userId) => ({
          tenant_id: ctx.tenantId,
          user_id: userId,
          kind: "mention",
          title: mentions.includes(userId)
            ? `${authorName}さんがタスクのコメントであなたをメンション`
            : `${authorName}さんが担当タスクにコメント`,
          body: `${taskLabel}\n${body.slice(0, 120)}`,
          href,
        })),
      );
    }

    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook && mentions.length > 0) {
      const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://lite-crm-tau.vercel.app"}${href}`;
      const to = mentions.map((m) => nameOf.get(m) ?? "—").join(" ");
      const text = `:speech_balloon: *${authorName}* さんが *${to}* さんをメンションしました（タスク）\n<${url}|${taskLabel}>\n> ${body.slice(0, 300)}`;
      await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    }
  } catch {
    /* 通知失敗は無視 */
  }

  revalidatePath("/app/tasks", "layout");
  return { ok: true };
}

/** タスクコメント削除（本人 or 管理者。権限はRLSが担保）。 */
export async function deleteTaskCommentAction(input: { id: string }): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("task_comments").delete().eq("id", input.id);
  revalidatePath("/app/tasks", "layout");
  return { ok: true };
}
