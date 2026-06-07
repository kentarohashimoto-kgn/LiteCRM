"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getCtx } from "@/lib/session";
import {
  addActivity,
  createAccount,
  createLead,
  createOpportunity,
  createTask,
  setTaskStatus,
  updateOpportunity,
} from "@/lib/data/store";
import type { Task } from "@/lib/types";

function num(v: FormDataEntryValue | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isNaN(n) ? undefined : n;
}
function str(v: FormDataEntryValue | null): string | undefined {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? undefined : s;
}

// ---- Session ----
export async function switchUser(formData: FormData) {
  const userId = String(formData.get("userId"));
  cookies().set(SESSION_COOKIE, userId, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/app/dashboard");
}

export async function logout() {
  cookies().delete(SESSION_COOKIE);
  redirect("/login");
}

// ---- Opportunities ----
export async function createOpportunityAction(formData: FormData) {
  const ctx = getCtx();
  const o = createOpportunity(ctx, {
    name: str(formData.get("name")),
    account_id: str(formData.get("account_id")),
    owner_user_id: str(formData.get("owner_user_id")),
    primary_product_id: str(formData.get("primary_product_id")),
    lead_source_id: str(formData.get("lead_source_id")),
    stage: str(formData.get("stage")) as never,
    forecast_category: str(formData.get("forecast_category")) as never,
    amount: num(formData.get("amount")),
    expected_close_date: str(formData.get("expected_close_date")),
    expected_revenue_month: str(formData.get("expected_close_date")),
    next_action_date: str(formData.get("next_action_date")),
    next_action_text: str(formData.get("next_action_text")),
    notes: str(formData.get("notes")),
  });
  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities/${o.id}`);
}

export async function updateOpportunityAction(formData: FormData) {
  const ctx = getCtx();
  const id = String(formData.get("id"));
  updateOpportunity(ctx, id, {
    stage: str(formData.get("stage")) as never,
    forecast_category: str(formData.get("forecast_category")) as never,
    amount: num(formData.get("amount")),
    expected_close_date: str(formData.get("expected_close_date")),
    expected_revenue_month: str(formData.get("expected_close_date")),
    next_action_date: str(formData.get("next_action_date")),
    next_action_text: str(formData.get("next_action_text")),
    risk_level: str(formData.get("risk_level")) as never,
    lost_reason: str(formData.get("lost_reason")),
    notes: str(formData.get("notes")),
  });
  revalidatePath(`/app/opportunities/${id}`);
  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities/${id}`);
}

// ---- Activities ----
export async function addActivityAction(formData: FormData) {
  const ctx = getCtx();
  const oppId = str(formData.get("opportunity_id"));
  addActivity(ctx, {
    opportunity_id: oppId,
    account_id: str(formData.get("account_id")),
    activity_type: str(formData.get("activity_type")) as never,
    title: str(formData.get("title")),
    body: str(formData.get("body")),
    next_action_date: str(formData.get("next_action_date")),
    next_action_text: str(formData.get("next_action_text")),
  });
  if (oppId) revalidatePath(`/app/opportunities/${oppId}`);
  revalidatePath("/app/activities");
}

// ---- Tasks ----
export async function createTaskAction(formData: FormData) {
  const ctx = getCtx();
  createTask(ctx, {
    title: str(formData.get("title")),
    opportunity_id: str(formData.get("opportunity_id")),
    account_id: str(formData.get("account_id")),
    assigned_to: str(formData.get("assigned_to")),
    due_date: str(formData.get("due_date")),
    priority: str(formData.get("priority")) as never,
  });
  revalidatePath("/app/tasks");
}

export async function setTaskStatusAction(formData: FormData) {
  const ctx = getCtx();
  setTaskStatus(ctx, String(formData.get("id")), String(formData.get("status")) as Task["status"]);
  revalidatePath("/app/tasks");
}

// ---- Accounts ----
export async function createAccountAction(formData: FormData) {
  const ctx = getCtx();
  const a = createAccount(ctx, {
    name: str(formData.get("name")),
    industry: str(formData.get("industry")),
    area: str(formData.get("area")),
    employee_size: str(formData.get("employee_size")),
    status: str(formData.get("status")) as never,
    priority: str(formData.get("priority")) as never,
    website_url: str(formData.get("website_url")),
    notes: str(formData.get("notes")),
  });
  revalidatePath("/app/accounts");
  redirect(`/app/accounts/${a.id}`);
}

// ---- Leads ----
export async function createLeadAction(formData: FormData) {
  const ctx = getCtx();
  createLead(ctx, {
    title: str(formData.get("title")),
    account_id: str(formData.get("account_id")),
    lead_source_id: str(formData.get("lead_source_id")),
    owner_user_id: str(formData.get("owner_user_id")),
    primary_product_id: str(formData.get("primary_product_id")),
    rank: str(formData.get("rank")) as never,
    status: str(formData.get("status")) as never,
  });
  revalidatePath("/app/leads");
}
