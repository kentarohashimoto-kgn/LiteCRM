"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/* ============================================================
 * BO-1 助成金トラッカー
 * ============================================================ */

/** 助成金案件を作成し、3つの定型マイルストーンを自動生成。 */
export async function createSubsidyCaseAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const accountName = String(formData.get("account_name") || "").trim();
  const trainingName = String(formData.get("training_name") || "").trim();
  const start = String(formData.get("training_start_date") || "");
  const end = String(formData.get("training_end_date") || "") || start;
  const oppId = String(formData.get("opportunity_id") || "") || null;
  if (!accountName || !trainingName || !start) return;

  const { data: c } = await sb
    .from("subsidy_cases")
    .insert({
      tenant_id: ctx.tenantId,
      opportunity_id: oppId,
      account_name: accountName,
      training_name: trainingName,
      training_start_date: start,
      training_end_date: end,
      assignee_user_id: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  if (!c) return;

  // 定型マイルストーン(期日ルールは設計書のデフォルト)
  await sb.from("subsidy_milestones").insert([
    { tenant_id: ctx.tenantId, case_id: c.id, kind: "briefing", label: "事前の説明会", due_date: addDays(start, -42) },
    { tenant_id: ctx.tenantId, case_id: c.id, kind: "pre_application", label: "助成金の事前申請（研修1ヶ月前まで）", due_date: addMonths(start, -1) },
    { tenant_id: ctx.tenantId, case_id: c.id, kind: "result_report", label: "助成金の実績報告（研修後2ヶ月まで）", due_date: addMonths(end, 2) },
  ]);
  revalidatePath("/app/bo/subsidies");
  revalidatePath("/app/bo");
}

/** マイルストーンの完了/未完了を切り替え。 */
export async function toggleMilestoneAction(formData: FormData): Promise<void> {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const done = String(formData.get("done")) === "1";
  await sb
    .from("subsidy_milestones")
    .update(done ? { status: "done", completed_at: new Date().toISOString().slice(0, 10) } : { status: "todo", completed_at: null })
    .eq("id", id);
  revalidatePath("/app/bo/subsidies");
  revalidatePath("/app/bo");
}

/** 助成金案件のステータス変更/削除。 */
export async function updateSubsidyCaseAction(formData: FormData): Promise<void> {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  if (op === "delete") await sb.from("subsidy_cases").delete().eq("id", id);
  else await sb.from("subsidy_cases").update({ status: op }).eq("id", id);
  revalidatePath("/app/bo/subsidies");
  revalidatePath("/app/bo");
}

/* ============================================================
 * BO-4 展示会準備WBS
 * ============================================================ */

/** 展示会プロジェクトを作成(確定ならテンプレートからWBSを自動生成)。 */
export async function createExpoProjectAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const name = String(formData.get("name") || "").trim();
  const starts = String(formData.get("starts_on") || "");
  const ends = String(formData.get("ends_on") || "") || starts;
  const venue = String(formData.get("venue") || "").trim();
  const confirmed = String(formData.get("confirmed")) === "1";
  if (!name || !starts) return;

  const { data: p } = await sb
    .from("expo_projects")
    .insert({ tenant_id: ctx.tenantId, name, starts_on: starts, ends_on: ends, venue: venue || null, status: confirmed ? "confirmed" : "planning" })
    .select("id")
    .maybeSingle();
  if (!p) return;
  if (confirmed) await generateExpoTasks(ctx.tenantId, p.id as string, starts);
  redirect(`/app/bo/expos/${p.id as string}`);
}

async function generateExpoTasks(tenantId: string, projectId: string, startsOn: string): Promise<void> {
  const sb = getSupabaseServer();
  const { data: templates } = await sb
    .from("expo_task_templates")
    .select("id, name, category, offset_days, sort_order")
    .eq("active", true)
    .order("sort_order");
  const { data: existing } = await sb.from("expo_tasks").select("name").eq("project_id", projectId);
  const existingNames = new Set((existing ?? []).map((t) => t.name as string));
  const rows = (templates ?? [])
    .filter((t) => !existingNames.has(t.name as string))
    .map((t) => ({
      tenant_id: tenantId,
      project_id: projectId,
      name: t.name as string,
      category: t.category as string,
      due_date: addDays(startsOn, t.offset_days as number),
    }));
  if (rows.length > 0) await sb.from("expo_tasks").insert(rows);
}

/** 「確定」: WBSをテンプレートから生成(既存タスクは重複生成しない)。 */
export async function confirmExpoAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const { data: p } = await sb.from("expo_projects").select("starts_on").eq("id", id).maybeSingle();
  if (!p) return;
  await sb.from("expo_projects").update({ status: "confirmed" }).eq("id", id);
  await generateExpoTasks(ctx.tenantId, id, p.starts_on as string);
  revalidatePath(`/app/bo/expos/${id}`);
  revalidatePath("/app/bo/expos");
}

/** 会期変更: 未完了タスクの期日を新会期基準で再計算。 */
export async function rescheduleExpoAction(formData: FormData): Promise<void> {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const starts = String(formData.get("starts_on") || "");
  const ends = String(formData.get("ends_on") || "") || starts;
  if (!starts) return;
  const { data: p } = await sb.from("expo_projects").select("starts_on").eq("id", id).maybeSingle();
  if (!p) return;
  const diffDays = Math.round((new Date(starts).getTime() - new Date(p.starts_on as string).getTime()) / 86400000);
  await sb.from("expo_projects").update({ starts_on: starts, ends_on: ends }).eq("id", id);
  if (diffDays !== 0) {
    const { data: tasks } = await sb.from("expo_tasks").select("id, due_date").eq("project_id", id).in("status", ["todo", "doing"]);
    for (const t of tasks ?? []) {
      await sb.from("expo_tasks").update({ due_date: addDays(t.due_date as string, diffDays) }).eq("id", t.id);
    }
  }
  revalidatePath(`/app/bo/expos/${id}`);
  revalidatePath("/app/bo/expos");
}

/** WBSタスクの状態切替/担当設定/追加/削除。 */
export async function updateExpoTaskAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const projectId = String(formData.get("project_id"));
  const op = String(formData.get("op"));
  if (op === "add") {
    const name = String(formData.get("name") || "").trim();
    const due = String(formData.get("due_date") || "");
    if (name && due) {
      await sb.from("expo_tasks").insert({
        tenant_id: ctx.tenantId,
        project_id: projectId,
        name,
        category: String(formData.get("category") || "その他"),
        due_date: due,
      });
    }
  } else {
    const id = String(formData.get("id"));
    if (op === "delete") await sb.from("expo_tasks").delete().eq("id", id);
    else if (op === "assign") await sb.from("expo_tasks").update({ assignee_user_id: String(formData.get("assignee") || "") || null }).eq("id", id);
    else await sb.from("expo_tasks").update({ status: op }).eq("id", id);
  }
  revalidatePath(`/app/bo/expos/${projectId}`);
  revalidatePath("/app/bo");
}

/** 当日運営の人員アサイン追加/削除。 */
export async function updateExpoStaffingAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const projectId = String(formData.get("project_id"));
  const op = String(formData.get("op"));
  if (op === "delete") {
    await sb.from("expo_staffing").delete().eq("id", String(formData.get("id")));
  } else {
    const date = String(formData.get("date") || "");
    const role = String(formData.get("role") || "lead_gen");
    const userId = String(formData.get("user_id") || "") || null;
    const memberName = String(formData.get("member_name") || "").trim() || null;
    if (date && (userId || memberName)) {
      await sb.from("expo_staffing").insert({ tenant_id: ctx.tenantId, project_id: projectId, date, role, user_id: userId, member_name: memberName });
      // アサインされた本人へ通知(営業メンバーはBO画面が見えないため通知で伝える)
      if (userId) {
        const { data: p } = await sb.from("expo_projects").select("name").eq("id", projectId).maybeSingle();
        const roleLabel = role === "lead_gen" ? "リード獲得要員" : role === "field_sales" ? "フィールドセールス" : "管理者";
        await sb.from("notifications").insert({
          tenant_id: ctx.tenantId,
          user_id: userId,
          kind: "system",
          title: `展示会の当日運営にアサインされました`,
          body: `${(p?.name as string) ?? "展示会"} ・ ${date} ・ 役割: ${roleLabel}`,
        });
      }
    }
  }
  revalidatePath(`/app/bo/expos/${projectId}`);
}

/** タスクプリセット(テンプレート)の追加/削除。 */
export async function updateExpoTemplateAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const op = String(formData.get("op"));
  if (op === "delete") {
    await sb.from("expo_task_templates").delete().eq("id", String(formData.get("id")));
  } else {
    const name = String(formData.get("name") || "").trim();
    // 入力は「会期初日の何日前か」(正数)。内部表現は負のオフセット
    const before = String(formData.get("offset_days_before") ?? "");
    const offset = before !== "" ? -Math.abs(Number(before)) : Number(formData.get("offset_days") ?? -30);
    if (name && !Number.isNaN(offset)) {
      await sb.from("expo_task_templates").insert({
        tenant_id: ctx.tenantId,
        name,
        category: String(formData.get("category") || "その他"),
        offset_days: offset,
        sort_order: Number(formData.get("sort_order") ?? 99) || 99,
      });
    }
  }
  revalidatePath("/app/bo/expos/templates");
}

/* ============================================================
 * BO-2 事例・インタビュー
 * ============================================================ */

export async function createCaseStudyAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const accountName = String(formData.get("account_name") || "").trim();
  if (!accountName) return;
  await sb.from("case_studies").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: String(formData.get("opportunity_id") || "") || null,
    account_name: accountName,
    training_name: String(formData.get("training_name") || "").trim() || null,
    assignee_user_id: ctx.userId,
  });
  revalidatePath("/app/bo/cases");
}

export async function updateCaseStudyAction(formData: FormData): Promise<void> {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  if (op === "delete") {
    await sb.from("case_studies").delete().eq("id", id);
  } else {
    await sb.from("case_studies").update({
      status: String(formData.get("status") || "not_approached"),
      published_url: String(formData.get("published_url") || "").trim() || null,
      next_action_date: String(formData.get("next_action_date") || "") || null,
      notes: String(formData.get("notes") || "").trim() || null,
    }).eq("id", id);
  }
  revalidatePath("/app/bo/cases");
}

/* ============================================================
 * BO-3 講師アンケート
 * ============================================================ */

export async function createTrainingSessionAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const course = String(formData.get("course") || "").trim();
  const instructor = String(formData.get("instructor") || "").trim();
  const heldOn = String(formData.get("held_on") || "");
  if (!course || !instructor || !heldOn) return;
  await sb.from("training_sessions").insert({
    tenant_id: ctx.tenantId,
    course,
    instructor,
    held_on: heldOn,
    account_name: String(formData.get("account_name") || "").trim() || null,
    attendee_count: Number(formData.get("attendee_count") || 0) || null,
  });
  revalidatePath("/app/bo/surveys");
}

/**
 * アンケート回答の貼り付け取込。1行=1回答、タブ/カンマ区切り:
 * 役職層(経営/管理職/一般), 職種, 年代, 満足度(1-5), 理解度(1-5), 講師評価(1-5), NPS(0-10), 自由記述
 */
export async function importSurveyResponsesAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const sessionId = String(formData.get("session_id"));
  const raw = String(formData.get("rows") || "").trim();
  if (!sessionId || !raw) return;
  const roleMap: Record<string, string> = { "経営": "exec", "経営層": "exec", "管理職": "manager", "一般": "staff", "一般社員": "staff" };
  const toInt = (s: string, min: number, max: number) => {
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
  };
  const rows = raw.split(/\r?\n/).map((line) => {
    const c = line.split(/\t|,/).map((x) => x.trim());
    if (c.length < 4) return null;
    return {
      tenant_id: ctx.tenantId,
      session_id: sessionId,
      role_level: roleMap[c[0]] ?? (["exec", "manager", "staff"].includes(c[0]) ? c[0] : null),
      job_category: c[1] || null,
      age_band: c[2] || null,
      satisfaction: toInt(c[3] ?? "", 1, 5),
      understanding: toInt(c[4] ?? "", 1, 5),
      instructor_score: toInt(c[5] ?? "", 1, 5),
      nps: toInt(c[6] ?? "", 0, 10),
      comment: (c[7] ?? "").slice(0, 2000) || null,
    };
  }).filter(Boolean);
  if (rows.length > 0) await sb.from("training_survey_responses").insert(rows as never[]);
  revalidatePath("/app/bo/surveys");
}

export async function deleteTrainingSessionAction(formData: FormData): Promise<void> {
  await requireBoCtx();
  const sb = getSupabaseServer();
  await sb.from("training_sessions").delete().eq("id", String(formData.get("id")));
  revalidatePath("/app/bo/surveys");
}

/* ============================================================
 * BO-6 研修後フォローアップ(1/3/6ヶ月後Mtg)
 * ============================================================ */

/** FU対象を手動追加(受注案件はDBトリガーで自動追加されるため、案件外の研修など向け)。 */
export async function createFuCaseAction(formData: FormData): Promise<void> {
  const ctx = await requireBoCtx();
  const sb = getSupabaseServer();
  const accountName = String(formData.get("account_name") || "").trim();
  const base = String(formData.get("won_date") || "") || new Date().toISOString().slice(0, 10);
  if (!accountName) return;
  const { data: c } = await sb
    .from("fu_cases")
    .insert({
      tenant_id: ctx.tenantId,
      account_name: accountName,
      training_name: String(formData.get("training_name") || "").trim() || null,
      won_date: base,
      assignee_user_id: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  if (!c) return;
  await sb.from("fu_meetings").insert(
    [1, 3, 6].map((m) => ({ tenant_id: ctx.tenantId, case_id: c.id, round_months: m, due_date: addMonths(base, m) })),
  );
  revalidatePath("/app/bo/followups");
  revalidatePath("/app/bo");
}

/** FUケースの完了/対象外/再開/削除。 */
export async function updateFuCaseAction(formData: FormData): Promise<void> {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  if (op === "delete") await sb.from("fu_cases").delete().eq("id", id);
  else await sb.from("fu_cases").update({ status: op }).eq("id", id);
  revalidatePath("/app/bo/followups");
  revalidatePath("/app/bo");
}

/** FU Mtg(1/3/6ヶ月後)の日程・実施・AI活用度・課題・提案・アップセルを保存。 */
export async function updateFuMeetingAction(formData: FormData): Promise<void> {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  if (!id) return;
  const scoreRaw = String(formData.get("ai_score") || "");
  const score = scoreRaw ? Math.max(0, Math.min(100, Number(scoreRaw))) : null;
  const heldOn = String(formData.get("held_on") || "") || null;
  const due = String(formData.get("due_date") || "");
  await sb
    .from("fu_meetings")
    .update({
      ...(due ? { due_date: due } : {}),
      schedule_status: String(formData.get("schedule_status") || "not_scheduled"),
      held_on: heldOn,
      ai_score: Number.isFinite(score as number) ? score : null,
      issues: String(formData.get("issues") || "").trim() || null,
      proposal_done: formData.get("proposal_done") === "on",
      upsell_status: String(formData.get("upsell_status") || "none"),
      notes: String(formData.get("notes") || "").trim() || null,
    })
    .eq("id", id);
  revalidatePath("/app/bo/followups");
  revalidatePath("/app/bo");
}
