"use server";

import { revalidatePath } from "next/cache";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/* ============================================================
 * BO-5 人材タレントシステム(人事のみ)
 * ============================================================ */

/** 求人案件(クライアント案件/カトルセ人員)を作成。 */
export async function createJobOpeningAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  await sb.from("job_openings").insert({
    tenant_id: ctx.tenantId,
    kind: String(formData.get("kind") || "internal"),
    title,
    client_name: String(formData.get("client_name") || "").trim() || null,
    role_description: String(formData.get("role_description") || "").trim() || null,
    rate_note: String(formData.get("rate_note") || "").trim() || null,
  });
  revalidatePath("/app/hr/openings");
}

/** 求人案件のステータス変更/削除。 */
export async function updateJobOpeningAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  if (op === "delete") await sb.from("job_openings").delete().eq("id", id);
  else await sb.from("job_openings").update({ status: op }).eq("id", id);
  revalidatePath("/app/hr/openings");
  revalidatePath("/app/hr/candidates");
}

/** 候補者を登録。 */
export async function createCandidateAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await sb.from("candidates").insert({
    tenant_id: ctx.tenantId,
    job_opening_id: String(formData.get("job_opening_id") || "") || null,
    name,
    email: String(formData.get("email") || "").trim() || null,
    source: String(formData.get("source") || "").trim() || null,
    assignee_user_id: ctx.userId,
  });
  revalidatePath("/app/hr/candidates");
}

/** 候補者のステータス変更・メモ更新・削除。joinedにしたらタレント台帳へ自動登録。 */
export async function updateCandidateAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const op = String(formData.get("op") || "save");
  if (op === "delete") {
    await sb.from("candidates").delete().eq("id", id);
    revalidatePath("/app/hr/candidates");
    return;
  }
  const status = String(formData.get("status") || "applied");
  const notes = String(formData.get("notes") || "").trim() || null;
  const { data: cand } = await sb
    .from("candidates")
    .update({ status, notes })
    .eq("id", id)
    .select("id, name, status")
    .maybeSingle();

  // 入社(joined)になったら、まだ無ければタレント台帳に自動追加
  if (cand && status === "joined") {
    const { data: exists } = await sb.from("talents").select("id").eq("candidate_id", id).limit(1);
    if (!exists?.length) {
      await sb.from("talents").insert({
        tenant_id: ctx.tenantId,
        candidate_id: id,
        name: cand.name as string,
        joined_on: new Date().toISOString().slice(0, 10),
      });
    }
  }
  revalidatePath("/app/hr/candidates");
  revalidatePath("/app/hr/talents");
}

/** 面接の記録を追加。 */
export async function addInterviewAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const candidateId = String(formData.get("candidate_id"));
  if (!candidateId) return;
  const scheduled = String(formData.get("scheduled_at") || "");
  const scoreRaw = String(formData.get("score") || "");
  await sb.from("interviews").insert({
    tenant_id: ctx.tenantId,
    candidate_id: candidateId,
    step: String(formData.get("step") || "first"),
    scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
    interviewer: String(formData.get("interviewer") || "").trim() || null,
    result: String(formData.get("result") || "") || null,
    score: scoreRaw ? Number(scoreRaw) : null,
    notes: String(formData.get("notes") || "").trim() || null,
  });
  revalidatePath("/app/hr/candidates");
}

/** タレント(稼働人員)を登録。 */
export async function createTalentAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const joined = String(formData.get("joined_on") || "");
  await sb.from("talents").insert({
    tenant_id: ctx.tenantId,
    name,
    employment_type: String(formData.get("employment_type") || "employee"),
    skills: String(formData.get("skills") || "").trim() || null,
    current_assignment: String(formData.get("current_assignment") || "").trim() || null,
    joined_on: joined || null,
  });
  revalidatePath("/app/hr/talents");
}

/** タレントの稼働先・スキル等の更新/退職/削除。 */
export async function updateTalentAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const op = String(formData.get("op") || "save");
  if (op === "delete") {
    await sb.from("talents").delete().eq("id", id);
  } else if (op === "leave") {
    await sb.from("talents").update({ left_on: new Date().toISOString().slice(0, 10) }).eq("id", id);
  } else {
    await sb
      .from("talents")
      .update({
        employment_type: String(formData.get("employment_type") || "employee"),
        skills: String(formData.get("skills") || "").trim() || null,
        current_assignment: String(formData.get("current_assignment") || "").trim() || null,
        notes: String(formData.get("notes") || "").trim() || null,
        // CRMログイン紐付け(稼働報告の本人特定に使用)。フォームに無い場合は変更しない
        ...(formData.has("user_id") ? { user_id: String(formData.get("user_id") || "").trim() || null } : {}),
      })
      .eq("id", id);
  }
  revalidatePath("/app/hr/talents");
}

/** 稼働中評価(期間・総合1-5・コメント・次期目標)を追加。 */
export async function addTalentReviewAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const talentId = String(formData.get("talent_id"));
  const period = String(formData.get("period") || "").trim();
  if (!talentId || !period) return;
  const overallRaw = String(formData.get("overall") || "");
  await sb.from("talent_reviews").insert({
    tenant_id: ctx.tenantId,
    talent_id: talentId,
    period,
    reviewer: String(formData.get("reviewer") || "").trim() || null,
    overall: overallRaw ? Number(overallRaw) : null,
    comment: String(formData.get("comment") || "").trim() || null,
    goals: String(formData.get("goals") || "").trim() || null,
  });
  revalidatePath("/app/hr/talents");
}
