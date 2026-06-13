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
      category: str(formData.get("category")),
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
      category: str(formData.get("category")),
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

// ===================== 目標(月別) =====================
export async function saveTargetsAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const fy = String(formData.get("fy") ?? "");
  const months = String(formData.get("months") ?? "").split(",").filter(Boolean);
  const rows = months.map((mk) => ({
    tenant_id: ctx.tenantId,
    target_month: mk,
    target_amount: num(formData.get(`m_${mk}_amount`)) ?? 0,
    target_deals: Math.round(num(formData.get(`m_${mk}_deals`)) ?? 0),
    target_appointments: Math.round(num(formData.get(`m_${mk}_appts`)) ?? 0),
    target_leads: Math.round(num(formData.get(`m_${mk}_leads`)) ?? 0),
  }));
  if (rows.length) {
    await sb.from("sales_targets").upsert(rows, { onConflict: "tenant_id,target_month" });
  }
  revalidatePath("/app/targets");
  revalidatePath("/app/forecast");
  revalidatePath("/app/dashboard");
  redirect("/app/targets?fy=" + encodeURIComponent(fy) + "&ok=1");
}

/** 営業マンのステータス(継続/契約予定/保留/解約)を更新 */
export async function setRepStatusAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb
    .from("memberships")
    .update({ rep_status: str(formData.get("rep_status")) })
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", String(formData.get("user_id")));
  revalidatePath("/app/analytics/sales-reps");
}

/** 営業マンの月別売上目標を保存(年度分) */
export async function saveRepTargetsAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const userId = String(formData.get("user_id"));
  const fy = String(formData.get("fy") ?? "");
  const months = String(formData.get("months") ?? "").split(",").filter(Boolean);
  const rows = months.map((mk) => ({
    tenant_id: ctx.tenantId,
    user_id: userId,
    target_month: mk,
    target_amount: num(formData.get(`m_${mk}_amount`)) ?? 0,
  }));
  if (rows.length) {
    await sb.from("rep_targets").upsert(rows, { onConflict: "tenant_id,user_id,target_month" });
  }
  revalidatePath("/app/targets");
  revalidatePath("/app/analytics/sales-reps");
  redirect("/app/targets?scope=" + encodeURIComponent(userId) + "&fy=" + encodeURIComponent(fy) + "&ok=1");
}

// ===================== 請求スケジュール(売上計画) =====================
export async function createBillingScheduleAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  if (!oppId) redirect("/app/opportunities");
  const kind = str(formData.get("kind")) === "recurring" ? "recurring" : "one_time";
  const startMonth = str(formData.get("recurring_start_month")); // YYYY-MM
  const endMonth = str(formData.get("recurring_end_month"));
  await sb.from("billing_schedules").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: oppId,
    account_id: str(formData.get("account_id")),
    kind,
    billing_date: kind === "one_time" ? str(formData.get("billing_date")) : null,
    amount: num(formData.get("amount")) ?? 0,
    recurring_start_month: kind === "recurring" && startMonth ? startMonth + "-01" : null,
    recurring_end_month: kind === "recurring" && endMonth ? endMonth + "-01" : null,
    note: str(formData.get("note")),
    created_by: ctx.userId,
  });
  revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/analytics/revenue");
  redirect(`/app/opportunities/${oppId}`);
}

export async function deleteBillingScheduleAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const oppId = str(formData.get("opportunity_id"));
  await sb.from("billing_schedules").delete().eq("id", String(formData.get("id")));
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/analytics/revenue");
  redirect(`/app/opportunities/${oppId}`);
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

/** 顧客のランク(S/A/B/C/D)を更新 */
export async function setAccountRankAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("accounts").update({ rank: str(formData.get("rank")) }).eq("id", String(formData.get("id")));
  revalidatePath("/app/accounts");
}

/** 顧客の重点フラグを更新 */
export async function setAccountFocusAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("accounts").update({ focus: str(formData.get("focus")) }).eq("id", String(formData.get("id")));
  revalidatePath("/app/accounts");
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

// ===================== リード取込(インポート) =====================
import { normalizeLead, priorityScore, type RawLeadInput } from "@/lib/lead-import";

/** 取込バッチを開始(履歴記録)。バッチIDを返す。 */
export async function startImportBatchAction(meta: { rawEvent: string; label?: string; sourceName?: string; rowCount: number }): Promise<{ batchId: string | null }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("lead_import_batches")
    .insert({ tenant_id: ctx.tenantId, raw_event: meta.rawEvent, label: meta.label, source_name: meta.sourceName, row_count: meta.rowCount, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !data) return { batchId: null };
  return { batchId: data.id };
}

/** 取込バッチを一括取り消し(リード削除＋履歴削除)。 */
export async function deleteImportBatchAction(batchId: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").delete().eq("tenant_id", ctx.tenantId).eq("import_batch_id", batchId);
  await sb.from("lead_import_batches").delete().eq("tenant_id", ctx.tenantId).eq("id", batchId);
  revalidatePath("/app/leads");
  return { ok: true };
}

/** リード1件を更新(優先度の必須項目含む)。スコアを再計算。 */
export async function updateLeadAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const base = num(formData.get("priority_base")) ?? 20;
  const fields = {
    company_name: str(formData.get("company_name")),
    contact_name: str(formData.get("contact_name")),
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    mobile_phone: str(formData.get("mobile_phone")),
    job_title: str(formData.get("job_title")),
    department: str(formData.get("department")),
    industry: str(formData.get("industry")),
    employee_size: str(formData.get("employee_size")),
    revenue_size: str(formData.get("revenue_size")),
    prefecture: str(formData.get("prefecture")),
    role_level: str(formData.get("role_level")),
    needs: str(formData.get("needs")),
    timing: str(formData.get("timing")),
    authority: str(formData.get("authority")),
    budget_band: str(formData.get("budget_band")),
    budget_amount: num(formData.get("budget_amount")),
    disposition: str(formData.get("disposition")),
    call_owner: str(formData.get("call_owner")),
    rank: str(formData.get("rank")),
    notes: str(formData.get("notes")),
  };
  const score = priorityScore(base, {
    employee_size: fields.employee_size,
    revenue_size: fields.revenue_size,
    role_level: fields.role_level,
    job_title: fields.job_title,
    needs: fields.needs,
    timing: fields.timing,
    authority: fields.authority,
    budget_band: fields.budget_band,
  });
  const status = fields.disposition === "appointment" ? "qualified" : fields.disposition === "ng" || fields.disposition === "excluded" ? "disqualified" : "new";
  await sb.from("leads").update({ ...fields, company_name: fields.company_name, priority_score: score, status }).eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/leads");
  redirect("/app/leads/" + id);
}

/** リード1件を削除。 */
export async function deleteLeadAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").delete().eq("id", String(formData.get("id"))).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/leads");
  redirect("/app/leads");
}

/** 指定イベントの既存リードを削除(置換取込の前処理)。 */
export async function clearLeadsForEventAction(rawEvent: string): Promise<{ deleted: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").delete().eq("tenant_id", ctx.tenantId).eq("raw_event", rawEvent);
  return { deleted: true };
}

/** リードを一括投入(クライアントから分割呼び出し)。 */
export async function importLeadsBatchAction(
  rows: RawLeadInput[],
  opts: { campaignId?: string | null; leadSourceId?: string | null; rawEvent: string; base: number; eventDate?: string | null; importBatchId?: string | null },
): Promise<{ inserted: number; error?: string }> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager", "sales_rep", "external_sales"].includes(ctx.role)) {
    return { inserted: 0, error: "権限がありません" };
  }
  const sb = getSupabaseServer();
  const recs = rows
    .filter((r) => (r.company ?? "").trim() !== "")
    .map((r) => normalizeLead(r, { ...opts, tenantId: ctx.tenantId }));
  if (recs.length === 0) return { inserted: 0 };
  const { error } = await sb.from("leads").insert(recs);
  if (error) return { inserted: 0, error: error.message };
  revalidatePath("/app/leads");
  return { inserted: recs.length };
}

/** リードを一括更新(重複=メール一致は上書き、新規は追加)。決着など変更分を反映。 */
const OVERWRITE_KEYS = [
  "disposition", "status", "call_owner", "deal_owner_name", "rank", "phone", "mobile_phone",
  "company_name", "contact_name", "department", "job_title", "industry", "employee_size",
  "prefecture", "acquirer", "tags", "notes", "scanned_at", "acquired_at", "campaign_id", "raw_event",
] as const;

export async function upsertLeadsBatchAction(
  rows: RawLeadInput[],
  opts: { campaignId?: string | null; leadSourceId?: string | null; rawEvent: string; base: number; eventDate?: string | null; importBatchId?: string | null },
): Promise<{ inserted: number; updated: number; error?: string }> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager", "sales_rep", "external_sales"].includes(ctx.role)) {
    return { inserted: 0, updated: 0, error: "権限がありません" };
  }
  const sb = getSupabaseServer();
  const recs = rows
    .filter((r) => (r.company ?? "").trim() !== "")
    .map((r) => normalizeLead(r, { ...opts, tenantId: ctx.tenantId }));
  if (recs.length === 0) return { inserted: 0, updated: 0 };

  const emails = [...new Set(recs.map((r) => (r.email as string | null) ?? "").filter(Boolean).map((e) => e.toLowerCase()))];
  const existing = new Map<string, Record<string, unknown>>();
  if (emails.length) {
    const { data } = await sb
      .from("leads")
      .select("id,email,priority_base,role_level,needs,timing,authority,budget_band,revenue_size,employee_size")
      .eq("tenant_id", ctx.tenantId)
      .in("email", emails);
    for (const row of data ?? []) existing.set(String((row.email ?? "")).toLowerCase(), row);
  }

  const toInsert: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const rec of recs) {
    const em = rec.email ? String(rec.email).toLowerCase() : null;
    const ex = em ? existing.get(em) : null;
    if (ex) {
      const patch: Record<string, unknown> = {};
      for (const k of OVERWRITE_KEYS) if (rec[k] != null) patch[k] = rec[k];
      patch.priority_score = priorityScore((ex.priority_base as number) ?? (rec.priority_base as number) ?? 20, {
        employee_size: (patch.employee_size as string) ?? (ex.employee_size as string),
        revenue_size: ex.revenue_size as string,
        role_level: (rec.role_level as string) ?? (ex.role_level as string),
        needs: ex.needs as string,
        timing: ex.timing as string,
        authority: ex.authority as string,
        budget_band: ex.budget_band as string,
      });
      updates.push({ id: String(ex.id), patch });
    } else {
      toInsert.push(rec);
    }
  }

  if (toInsert.length) {
    const { error } = await sb.from("leads").insert(toInsert);
    if (error) return { inserted: 0, updated: 0, error: error.message };
  }
  for (let i = 0; i < updates.length; i += 20) {
    await Promise.all(updates.slice(i, i + 20).map((u) => sb.from("leads").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId)));
  }
  revalidatePath("/app/leads");
  return { inserted: toInsert.length, updated: updates.length };
}

/** 展示会・施策(campaign)の表示名を変更。 */
export async function updateCampaignNameAction(id: string, name: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const n = name.trim();
  if (!n) return { ok: false };
  await sb.from("campaigns").update({ name: n.slice(0, 200) }).eq("id", id).eq("tenant_id", ctx.tenantId);
  revalidatePath("/app/analytics/exhibitions");
  revalidatePath("/app/analytics/channels");
  return { ok: true };
}

/** 取得担当(ブース読取担当)の別名(数字→名前)を設定。 */
export async function setAcquirerAliasAction(raw: string, displayName: string): Promise<{ ok: boolean }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb
    .from("acquirer_aliases")
    .upsert({ tenant_id: ctx.tenantId, raw, display_name: displayName || null }, { onConflict: "tenant_id,raw" });
  revalidatePath("/app/leads");
  return { ok: true };
}

/** リードの決着ステータスを更新 */
export async function setLeadDispositionAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const disp = str(formData.get("disposition"));
  const status = disp === "appointment" ? "qualified" : disp === "ng" || disp === "excluded" ? "disqualified" : "new";
  await sb.from("leads").update({ disposition: disp, status }).eq("id", String(formData.get("id")));
  revalidatePath("/app/leads");
}

/** リードの架電担当(対応)を更新 */
export async function setLeadCallOwnerAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("leads").update({ call_owner: str(formData.get("call_owner")) }).eq("id", String(formData.get("id")));
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
