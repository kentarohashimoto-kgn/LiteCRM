"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireCtx } from "@/lib/session";
import { STAGE_MAP } from "@/lib/constants";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isNaN(n) ? null : n;
}
function str(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

// ===================== 認証 =====================
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect("/login?error=" + encodeURIComponent("メールアドレスまたはパスワードが正しくありません"));
  }
  redirect("/app/dashboard");
}

export async function signOut() {
  const supabase = getSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

// ===================== 商談 =====================
export async function createOpportunityAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const stage = (str(formData.get("stage")) ?? "lead_acquired") as keyof typeof STAGE_MAP;
  const close = str(formData.get("expected_close_date"));
  const { data, error } = await sb
    .from("opportunities")
    .insert({
      tenant_id: ctx.tenantId,
      name: str(formData.get("name")),
      account_id: str(formData.get("account_id")),
      owner_user_id: str(formData.get("owner_user_id")) ?? ctx.userId,
      primary_product_id: str(formData.get("primary_product_id")),
      lead_source_id: str(formData.get("lead_source_id")),
      stage,
      forecast_category: str(formData.get("forecast_category")) ?? "pipeline",
      amount: num(formData.get("amount")) ?? 0,
      probability: STAGE_MAP[stage]?.probability ?? 10,
      expected_close_date: close,
      expected_revenue_month: close ? close.slice(0, 7) + "-01" : null,
      next_action_date: str(formData.get("next_action_date")),
      next_action_text: str(formData.get("next_action_text")),
      last_activity_at: new Date().toISOString(),
      notes: str(formData.get("notes")),
      status: "open",
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect("/app/opportunities?error=" + encodeURIComponent("作成に失敗しました: " + (error?.message ?? "")));
  }
  await sb.from("stage_histories").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: data.id,
    to_stage: stage,
    changed_by: ctx.userId,
    reason: "新規作成",
  });
  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities/${data.id}`);
}

export async function updateOpportunityAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const stage = str(formData.get("stage")) as keyof typeof STAGE_MAP | null;
  const close = str(formData.get("expected_close_date"));
  const status =
    stage === "won" ? "won" : stage === "lost" ? "lost" : stage === "on_hold" ? "on_hold" : "open";
  await sb
    .from("opportunities")
    .update({
      stage,
      forecast_category: str(formData.get("forecast_category")),
      amount: num(formData.get("amount")) ?? 0,
      probability: stage ? STAGE_MAP[stage]?.probability ?? 10 : undefined,
      expected_close_date: close,
      expected_revenue_month: close ? close.slice(0, 7) + "-01" : null,
      next_action_date: str(formData.get("next_action_date")),
      next_action_text: str(formData.get("next_action_text")),
      risk_level: str(formData.get("risk_level")),
      lost_reason: str(formData.get("lost_reason")),
      notes: str(formData.get("notes")),
      status,
    })
    .eq("id", id);
  revalidatePath(`/app/opportunities/${id}`);
  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities/${id}`);
}

/** 商談を展示会・施策インスタンスへ紐付け(手動修正)。推定フラグは解除する。 */
export async function setOpportunityCampaignAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const campaignId = str(formData.get("campaign_id"));
  await sb
    .from("opportunities")
    .update({ campaign_id: campaignId, campaign_estimated: false })
    .eq("id", id);
  revalidatePath(`/app/opportunities/${id}`);
  revalidatePath("/app/opportunities");
  revalidatePath("/app/analytics/exhibitions");
  redirect(`/app/opportunities/${id}`);
}

// ===================== 商談(meetings) =====================
/** 案件配下に商談(1回)を登録。 */
export async function createMeetingAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  if (!oppId) {
    redirect("/app/opportunities?error=" + encodeURIComponent("案件が指定されていません"));
  }
  const meetingDate = str(formData.get("meeting_date"));
  const nextDate = str(formData.get("next_action_date"));
  const nextText = str(formData.get("next_action_text"));
  await sb.from("meetings").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: str(formData.get("account_id")),
    owner_user_id: str(formData.get("owner_user_id")) ?? ctx.userId,
    title: str(formData.get("title")) ?? "商談",
    meeting_date: meetingDate,
    method: str(formData.get("method")),
    summary: str(formData.get("summary")),
    next_action_date: nextDate,
    next_action_text: nextText,
    created_by: ctx.userId,
  });
  // 親案件の最終活動/次アクションを更新
  const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
  if (nextDate) {
    patch.next_action_date = nextDate;
    patch.next_action_text = nextText;
  }
  await sb.from("opportunities").update(patch).eq("id", oppId);
  revalidatePath(`/app/opportunities/${oppId}`);
  redirect(`/app/opportunities/${oppId}`);
}

export async function updateMeetingAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const oppId = str(formData.get("opportunity_id"));
  await sb
    .from("meetings")
    .update({
      title: str(formData.get("title")) ?? "商談",
      meeting_date: str(formData.get("meeting_date")),
      method: str(formData.get("method")),
      summary: str(formData.get("summary")),
      next_action_date: str(formData.get("next_action_date")),
      next_action_text: str(formData.get("next_action_text")),
    })
    .eq("id", id);
  revalidatePath(`/app/opportunities/${oppId}/meetings/${id}`);
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  redirect(`/app/opportunities/${oppId}/meetings/${id}`);
}

// ===================== 活動 =====================
export async function addActivityAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  const nextDate = str(formData.get("next_action_date"));
  const nextText = str(formData.get("next_action_text"));
  const activityAt = new Date().toISOString();

  await sb.from("activities").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: str(formData.get("account_id")),
    owner_user_id: ctx.userId,
    activity_type: str(formData.get("activity_type")) ?? "note",
    title: str(formData.get("title")),
    body: str(formData.get("body")),
    activity_at: activityAt,
    next_action_date: nextDate,
    next_action_text: nextText,
  });

  if (oppId) {
    const patch: Record<string, unknown> = { last_activity_at: activityAt };
    if (nextDate) {
      patch.next_action_date = nextDate;
      patch.next_action_text = nextText;
    }
    await sb.from("opportunities").update(patch).eq("id", oppId);
    revalidatePath(`/app/opportunities/${oppId}`);
  }
  revalidatePath("/app/activities");
}

// ===================== タスク =====================
export async function createTaskAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("tasks").insert({
    tenant_id: ctx.tenantId,
    title: str(formData.get("title")),
    opportunity_id: str(formData.get("opportunity_id")),
    account_id: str(formData.get("account_id")),
    assigned_to: str(formData.get("assigned_to")) ?? ctx.userId,
    created_by: ctx.userId,
    due_date: str(formData.get("due_date")),
    priority: str(formData.get("priority")) ?? "middle",
    status: "todo",
  });
  revalidatePath("/app/tasks");
}

export async function setTaskStatusAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const status = String(formData.get("status"));
  await sb
    .from("tasks")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", String(formData.get("id")));
  revalidatePath("/app/tasks");
}

// ===================== 顧客 =====================
export async function createAccountAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("accounts")
    .insert({
      tenant_id: ctx.tenantId,
      owner_user_id: ctx.userId,
      name: str(formData.get("name")),
      industry: str(formData.get("industry")),
      area: str(formData.get("area")),
      employee_size: str(formData.get("employee_size")),
      status: str(formData.get("status")) ?? "prospect",
      priority: str(formData.get("priority")),
      website_url: str(formData.get("website_url")),
      notes: str(formData.get("notes")),
    })
    .select("id")
    .single();
  if (error || !data) {
    redirect("/app/accounts?error=" + encodeURIComponent("作成に失敗しました"));
  }
  revalidatePath("/app/accounts");
  redirect(`/app/accounts/${data.id}`);
}

// ===================== リード =====================
export async function createLeadAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").insert({
    tenant_id: ctx.tenantId,
    title: str(formData.get("title")),
    account_id: str(formData.get("account_id")),
    lead_source_id: str(formData.get("lead_source_id")),
    owner_user_id: str(formData.get("owner_user_id")) ?? ctx.userId,
    primary_product_id: str(formData.get("primary_product_id")),
    rank: str(formData.get("rank")),
    status: str(formData.get("status")) ?? "new",
  });
  revalidatePath("/app/leads");
}

// ===================== メンバー発行(管理者) =====================
export async function createMemberAction(formData: FormData) {
  const ctx = await requireCtx();
  if (!["owner", "admin"].includes(ctx.role)) {
    redirect("/app/settings?error=" + encodeURIComponent("メンバー発行は管理者のみ可能です"));
  }
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("display_name") ?? "").trim();
  const role = String(formData.get("role") ?? "sales_rep");
  const password = String(formData.get("password") ?? "").trim();
  if (!email || !password) {
    redirect("/app/settings?error=" + encodeURIComponent("メールと初期パスワードは必須です"));
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name || email.split("@")[0] },
  });
  if (error || !data.user) {
    redirect("/app/settings?error=" + encodeURIComponent("発行に失敗: " + (error?.message ?? "")));
  }
  await admin.from("memberships").insert({
    tenant_id: ctx.tenantId,
    user_id: data.user.id,
    role,
  });
  revalidatePath("/app/settings");
  redirect("/app/settings?ok=" + encodeURIComponent(`${email} を発行しました`));
}
