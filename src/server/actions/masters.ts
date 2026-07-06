"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const ctx = await requireCtx();
  if (!["owner", "admin"].includes(ctx.role)) throw new Error("管理者のみ操作できます");
  return ctx;
}

// ===================== メンバー管理(管理者・service role) =====================
/** 氏名・ロール・メモを更新。 */
export async function updateMemberAction(input: { userId: string; name: string; role: string; memo: string | null }): Promise<Result> {
  const ctx = await requireAdmin();
  const admin = getSupabaseAdmin();
  const name = input.name.trim();
  if (name) {
    await admin.from("profiles").update({ display_name: name }).eq("id", input.userId);
    await admin.auth.admin.updateUserById(input.userId, { user_metadata: { display_name: name } });
  }
  const { error } = await admin.from("memberships").update({ role: input.role, memo: input.memo || null }).eq("user_id", input.userId).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings");
  return { ok: true };
}

/** メールアドレスを変更(認証情報)。 */
export async function setMemberEmailAction(input: { userId: string; email: string }): Promise<Result> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  const email = input.email.trim();
  if (!email) return { ok: false, error: "メールを入力してください" };
  const { error } = await admin.auth.admin.updateUserById(input.userId, { email, email_confirm: true });
  if (error) return { ok: false, error: error.message };
  await admin.from("profiles").update({ email }).eq("id", input.userId);
  revalidatePath("/app/settings");
  return { ok: true };
}

/** パスワードを再設定。 */
export async function setMemberPasswordAction(input: { userId: string; password: string }): Promise<Result> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  if (input.password.trim().length < 8) return { ok: false, error: "パスワードは8文字以上にしてください" };
  const { error } = await admin.auth.admin.updateUserById(input.userId, { password: input.password.trim() });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** メンバーを削除(所属解除＋認証ユーザー削除)。自分・オーナーは不可。 */
export async function deleteMemberAction(input: { userId: string }): Promise<Result> {
  const ctx = await requireAdmin();
  if (input.userId === ctx.userId) return { ok: false, error: "自分自身は削除できません" };
  const admin = getSupabaseAdmin();
  const { data: m } = await admin.from("memberships").select("role").eq("user_id", input.userId).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (m?.role === "owner") return { ok: false, error: "オーナーは削除できません" };
  await admin.from("memberships").delete().eq("user_id", input.userId).eq("tenant_id", ctx.tenantId);
  await admin.auth.admin.deleteUser(input.userId).catch(() => {});
  revalidatePath("/app/settings");
  return { ok: true };
}

// ===================== 商材(products) =====================
export async function saveProductAction(input: {
  id: string | null; name: string; category: string | null; product_type: string | null;
  default_price: number | null; unit_cost: number | null; priority_flag: boolean; status: string;
}): Promise<Result> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  if (!input.name.trim()) return { ok: false, error: "名称を入力してください" };
  const row = {
    name: input.name.trim(), category: input.category, product_type: input.product_type,
    default_price: input.default_price, unit_cost: input.unit_cost, priority_flag: input.priority_flag, status: input.status,
  };
  const { error } = input.id
    ? await sb.from("products").update(row).eq("id", input.id)
    : await sb.from("products").insert({ ...row, tenant_id: ctx.tenantId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings");
  return { ok: true };
}
export async function deleteProductAction(input: { id: string }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("products").delete().eq("id", input.id);
  if (error) return { ok: false, error: "この商材は案件で使用中のため削除できません（無効化をご利用ください）" };
  revalidatePath("/app/settings");
  return { ok: true };
}

// ===================== 流入経路(lead_sources) =====================
export async function saveLeadSourceAction(input: { id: string | null; name: string; description: string | null; status: string }): Promise<Result> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  if (!input.name.trim()) return { ok: false, error: "名称を入力してください" };
  const row = { name: input.name.trim(), description: input.description, status: input.status };
  const { error } = input.id
    ? await sb.from("lead_sources").update(row).eq("id", input.id)
    : await sb.from("lead_sources").insert({ ...row, tenant_id: ctx.tenantId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings");
  return { ok: true };
}
export async function deleteLeadSourceAction(input: { id: string }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("lead_sources").delete().eq("id", input.id);
  if (error) return { ok: false, error: "この流入経路は使用中のため削除できません" };
  revalidatePath("/app/settings");
  return { ok: true };
}

// ===================== 流入詳細(lead_source_details) =====================
/** 流入経路ごとの詳細選択肢(各展示会・各パートナー等)を追加。 */
export async function addLeadSourceDetailAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const leadSourceId = String(formData.get("lead_source_id") || "");
  const name = String(formData.get("name") || "").trim();
  if (!leadSourceId || !name) return;
  await sb.from("lead_source_details").upsert(
    { tenant_id: ctx.tenantId, lead_source_id: leadSourceId, name },
    { onConflict: "tenant_id,lead_source_id,name", ignoreDuplicates: true },
  );
  revalidatePath("/app/settings");
}

/** 流入詳細の削除(選択肢から外すだけ。既存案件の記録は消えない)。 */
export async function deleteLeadSourceDetailAction(formData: FormData): Promise<void> {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("lead_source_details").delete().eq("id", String(formData.get("id")));
  revalidatePath("/app/settings");
}

// ===================== 展示会・施策(campaigns) =====================
export async function saveCampaignAction(input: { id: string | null; name: string; channel: string | null; notes: string | null }): Promise<Result> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  if (!input.name.trim()) return { ok: false, error: "名称を入力してください" };
  const row = { name: input.name.trim(), channel: input.channel, notes: input.notes };
  const { error } = input.id
    ? await sb.from("campaigns").update(row).eq("id", input.id)
    : await sb.from("campaigns").insert({ ...row, tenant_id: ctx.tenantId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings");
  return { ok: true };
}
export async function deleteCampaignAction(input: { id: string }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("campaigns").delete().eq("id", input.id);
  if (error) return { ok: false, error: "この施策は案件・リードで使用中のため削除できません" };
  revalidatePath("/app/settings");
  return { ok: true };
}

// ===================== 予約URL(booking_links) =====================
export async function saveBookingLinkAction(input: { id: string | null; label: string; url: string }): Promise<Result> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  if (!input.label.trim() || !input.url.trim()) return { ok: false, error: "担当名とURLを入力してください" };
  const row = { label: input.label.trim(), url: input.url.trim() };
  const { error } = input.id
    ? await sb.from("booking_links").update(row).eq("id", input.id)
    : await sb.from("booking_links").insert({ ...row, tenant_id: ctx.tenantId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings");
  revalidatePath("/app/opportunities");
  return { ok: true };
}
export async function deleteBookingLinkAction(input: { id: string }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("booking_links").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings");
  revalidatePath("/app/opportunities");
  return { ok: true };
}
