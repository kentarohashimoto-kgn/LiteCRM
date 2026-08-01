"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/* ============================================================
 * BO-5 人材タレントシステム(人事のみ)
 * ============================================================ */

// フォーム値の取り出しヘルパ
const str = (fd: FormData, k: string): string | null => (String(fd.get(k) || "").trim() || null);
const dateOrNull = (fd: FormData, k: string): string | null => (String(fd.get(k) || "").trim() || null);
/** 年齢など: 整数のみ。空はnull。 */
const intOrNull = (fd: FormData, k: string): number | null => {
  const raw = String(fd.get(k) || "").replace(/[^\d]/g, "");
  return raw ? Number(raw) : null;
};
/** 募集人数など: 小数点1桁までの数値。空はnull。 */
const num1 = (fd: FormData, k: string): number | null => {
  const raw = String(fd.get(k) || "").replace(/[^\d.]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

/** 求人案件の全項目(区分別)を1オブジェクトに整形。create/save共通。 */
function jobOpeningFields(fd: FormData) {
  const kind = String(fd.get("kind") || "internal");
  const employmentTypes = fd.getAll("employment_types").map((v) => String(v)).filter(Boolean);
  return {
    kind,
    title: String(fd.get("title") || "").trim(),
    role_description: str(fd, "role_description"),
    rate_note: str(fd, "rate_note"), // UI上は「メモ」
    headcount: num1(fd, "headcount"),
    priority: str(fd, "priority"),
    work_style: str(fd, "work_style"),
    // クライアント名: internalでは常にnull
    client_name: kind === "client" ? str(fd, "client_name") : null,
    // カトルセ人員(internal)専用
    employment_types: kind === "internal" && employmentTypes.length ? employmentTypes : null,
    workload: kind === "internal" ? str(fd, "workload") : null,
    pay_rate: kind === "internal" ? str(fd, "pay_rate") : null,
    start_on: kind === "internal" ? dateOrNull(fd, "start_on") : null,
    required_skills: kind === "internal" ? str(fd, "required_skills") : null,
    recruit_channel: kind === "internal" ? str(fd, "recruit_channel") : null,
    // クライアント案件(client)専用
    end_client: kind === "client" ? str(fd, "end_client") : null,
    upstream_company: kind === "client" ? str(fd, "upstream_company") : null,
    distribution: kind === "client" ? str(fd, "distribution") : null,
    client_rate: kind === "client" ? str(fd, "client_rate") : null,
    pay_limit: kind === "client" ? str(fd, "pay_limit") : null,
    expected_margin: kind === "client" ? str(fd, "expected_margin") : null,
    settlement_terms: kind === "client" ? str(fd, "settlement_terms") : null,
    payment_site: kind === "client" ? str(fd, "payment_site") : null,
    interview_count: kind === "client" ? str(fd, "interview_count") : null,
    project_start_on: kind === "client" ? dateOrNull(fd, "project_start_on") : null,
    project_end_on: kind === "client" ? dateOrNull(fd, "project_end_on") : null,
  };
}

/** 求人案件を作成(一覧の簡易追加)。作成後は詳細ページへ遷移し、残りを入力できる。 */
export async function createJobOpeningAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const { data } = await sb
    .from("job_openings")
    .insert({
      tenant_id: ctx.tenantId,
      kind: String(formData.get("kind") || "internal"),
      title,
      client_name: String(formData.get("kind")) === "client" ? str(formData, "client_name") : null,
    })
    .select("id")
    .maybeSingle();
  revalidatePath("/app/hr/openings");
  if (data?.id) redirect(`/app/hr/openings/${data.id}`);
}

/** 求人案件の全項目を保存(詳細/編集フォーム)。 */
export async function saveJobOpeningAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const fields = jobOpeningFields(formData);
  if (!id || !fields.title) redirect(`/app/hr/openings/${id}?error=invalid`);
  await sb.from("job_openings").update(fields).eq("id", id);
  revalidatePath(`/app/hr/openings/${id}`);
  revalidatePath("/app/hr/openings");
  redirect(`/app/hr/openings/${id}?saved=1`);
}

/** 求人ステータス変更。募集中/選考中/クローズ(＋理由)。クローズ→募集中に戻す。 */
export async function updateJobOpeningStatusAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const status = String(formData.get("status") || "open");
  const closeReason = status === "closed" ? str(formData, "close_reason") : null;
  await sb.from("job_openings").update({ status, close_reason: closeReason }).eq("id", id);
  revalidatePath("/app/hr/openings");
  revalidatePath(`/app/hr/openings/${id}`);
  revalidatePath("/app/hr/candidates");
}

/** 求人案件を削除(確認はUI側)。 */
export async function deleteJobOpeningAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  await sb.from("job_openings").delete().eq("id", id);
  revalidatePath("/app/hr/openings");
  redirect("/app/hr/openings");
}

/** 候補者を登録(一覧の簡易追加)。作成後は詳細ページへ遷移。求人が指定されれば紐付けも作成。 */
export async function createCandidateAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const openingId = String(formData.get("job_opening_id") || "") || null;
  const { data } = await sb
    .from("candidates")
    .insert({
      tenant_id: ctx.tenantId,
      job_opening_id: openingId,
      name,
      email: str(formData, "email"),
      age: intOrNull(formData, "age"),
      source: str(formData, "source"),
      assignee_user_id: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  if (data?.id && openingId) {
    await sb.from("candidate_openings").insert({
      tenant_id: ctx.tenantId,
      candidate_id: data.id,
      job_opening_id: openingId,
    });
  }
  revalidatePath("/app/hr/candidates");
  if (data?.id) redirect(`/app/hr/candidates/${data.id}`);
}

/** 候補者の基本情報(全項目)を保存(詳細/編集フォーム)。 */
export async function saveCandidateAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  if (!id || !name) redirect(`/app/hr/candidates/${id}?error=invalid`);
  await sb
    .from("candidates")
    .update({
      name,
      furigana: str(formData, "furigana"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      area: str(formData, "area"),
      age: intOrNull(formData, "age"),
      source: str(formData, "source"),
      notes: str(formData, "notes"), // 人事コメント
      desired_conditions: str(formData, "desired_conditions"),
      desired_contract: str(formData, "desired_contract"),
      available_from: str(formData, "available_from"),
      desired_workload: str(formData, "desired_workload"),
      desired_pay: str(formData, "desired_pay"),
      work_location_pref: str(formData, "work_location_pref"),
      skills: str(formData, "skills"),
    })
    .eq("id", id);
  revalidatePath(`/app/hr/candidates/${id}`);
  revalidatePath("/app/hr/candidates");
  redirect(`/app/hr/candidates/${id}?saved=1`);
}

/** 候補者のステータス変更(一覧/詳細のクイック操作)。joinedでタレント台帳へ自動登録。 */
export async function updateCandidateStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const status = String(formData.get("status") || "applied");
  const { data: cand } = await sb
    .from("candidates")
    .update({ status })
    .eq("id", id)
    .select("id, name, status, email, skills, notes")
    .maybeSingle();
  if (cand && status === "joined") {
    const { data: exists } = await sb.from("talents").select("id").eq("candidate_id", id).limit(1);
    if (!exists?.length) {
      // 候補者に入力済みの情報(メール/スキル/人事コメント)は台帳へ引き継ぐ
      await sb.from("talents").insert({
        tenant_id: ctx.tenantId,
        candidate_id: id,
        name: cand.name as string,
        email: (cand.email as string | null) ?? null,
        skills: (cand.skills as string | null) ?? null,
        notes: (cand.notes as string | null) ?? null,
        joined_on: new Date().toISOString().slice(0, 10),
      });
    }
  }
  revalidatePath("/app/hr/candidates");
  revalidatePath(`/app/hr/candidates/${id}`);
  revalidatePath("/app/hr/talents");
}

/** 候補者を削除(確認はUI側)。 */
export async function deleteCandidateAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  await sb.from("candidates").delete().eq("id", id);
  revalidatePath("/app/hr/candidates");
  redirect("/app/hr/candidates");
}

/** 候補者に求人案件を紐付け(多対多)。同一組合せは無視。 */
export async function linkCandidateOpeningAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const candidateId = String(formData.get("candidate_id"));
  const openingId = String(formData.get("job_opening_id") || "");
  if (!candidateId || !openingId) return;
  await sb
    .from("candidate_openings")
    .upsert(
      { tenant_id: ctx.tenantId, candidate_id: candidateId, job_opening_id: openingId, role_note: str(formData, "role_note") },
      { onConflict: "candidate_id,job_opening_id", ignoreDuplicates: true },
    );
  revalidatePath(`/app/hr/candidates/${candidateId}`);
}

/** 候補者の求人紐付けを解除。 */
export async function unlinkCandidateOpeningAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const candidateId = String(formData.get("candidate_id"));
  const linkId = String(formData.get("link_id"));
  if (!linkId) return;
  await sb.from("candidate_openings").delete().eq("id", linkId);
  revalidatePath(`/app/hr/candidates/${candidateId}`);
}

/** 選考履歴を追加(定性評価・次回アクション含む)。 */
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
    interviewer: str(formData, "interviewer"),
    result: String(formData.get("result") || "") || null,
    score: scoreRaw ? Number(scoreRaw) : null,
    notes: str(formData, "notes"),
    good_points: str(formData, "good_points"),
    concerns: str(formData, "concerns"),
    next_action: str(formData, "next_action"),
    next_action_due: dateOrNull(formData, "next_action_due"),
  });
  revalidatePath(`/app/hr/candidates/${candidateId}`);
}

/** 選考履歴を削除。 */
export async function deleteInterviewAction(formData: FormData): Promise<void> {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const candidateId = String(formData.get("candidate_id"));
  if (!id) return;
  await sb.from("interviews").delete().eq("id", id);
  revalidatePath(`/app/hr/candidates/${candidateId}`);
}

/** タレント(稼働人員)を登録。 */
export async function createTalentAction(formData: FormData): Promise<void> {
  const ctx = await requireHrCtx();
  const sb = getSupabaseServer();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const joined = String(formData.get("joined_on") || "");
  const rate = String(formData.get("hourly_rate") || "").replace(/[^\d.]/g, "");
  await sb.from("talents").insert({
    tenant_id: ctx.tenantId,
    name,
    employment_type: String(formData.get("employment_type") || "employee"),
    skills: String(formData.get("skills") || "").trim() || null,
    current_assignment: String(formData.get("current_assignment") || "").trim() || null,
    joined_on: joined || null,
    department: String(formData.get("department") || "").trim() || null,
    role_text: String(formData.get("role_text") || "").trim() || null,
    email: String(formData.get("email") || "").trim() || null,
    hourly_rate: rate ? Number(rate) : null,
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
    const str = (k: string) => String(formData.get(k) || "").trim() || null;
    const rate = String(formData.get("hourly_rate") || "").replace(/[^\d.]/g, "");
    await sb
      .from("talents")
      .update({
        employment_type: String(formData.get("employment_type") || "employee"),
        notes: str("notes"),
        // 台帳拡張(0122)
        title: str("title"),
        department: str("department"),
        role_text: str("role_text"),
        layer: str("layer"),
        contract_status: str("contract_status") ?? "継続",
        email: str("email"),
        mail_system: str("mail_system"),
        hourly_rate: rate ? Number(rate) : null,
        cost_managed: formData.get("cost_managed") === "on",
        work_report_required: formData.get("work_report_required") === "on",
        // フォームに無い項目は変更しない
        ...(formData.has("skills") ? { skills: str("skills") } : {}),
        ...(formData.has("current_assignment") ? { current_assignment: str("current_assignment") } : {}),
        // CRMログイン紐付け(稼働報告の本人特定に使用)
        ...(formData.has("user_id") ? { user_id: str("user_id") } : {}),
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
