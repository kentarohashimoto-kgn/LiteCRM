"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { canReassignOwner, isHexColor } from "@/lib/constants";

type Result = { ok: boolean; error?: string };

/** 対象ユーザーが呼び出し元テナントのメンバーであることを確認する。 */
async function assertMemberOfTenant(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * カレンダーの担当色を変更する（profiles.avatar_color を更新＝アプリ全体に反映）。
 * 代表・管理者・営業マネージャーのみ。RLS(本人のみ更新可)を越えるため admin で行う。
 */
export async function setOwnerColorAction(input: { userId: string; color: string }): Promise<Result> {
  const ctx = await requireCtx();
  if (!canReassignOwner(ctx.role)) return { ok: false, error: "担当の色を変更できるのは代表・管理者・営業マネージャーのみです" };
  const color = (input.color || "").trim();
  if (!isHexColor(color)) return { ok: false, error: "色の形式が不正です" };

  const admin = getSupabaseAdmin();
  if (!(await assertMemberOfTenant(admin, ctx.tenantId, input.userId))) {
    return { ok: false, error: "対象の担当が見つかりません" };
  }
  const { error } = await admin.from("profiles").update({ avatar_color: color }).eq("id", input.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/opportunities");
  return { ok: true };
}

/**
 * カレンダーの凡例/表示から担当を隠す・戻す（memberships.calendar_hidden）。
 * テナント×ユーザー単位なので、この組織のカレンダーだけに効く。
 */
export async function setOwnerCalendarHiddenAction(input: { userId: string; hidden: boolean }): Promise<Result> {
  const ctx = await requireCtx();
  if (!canReassignOwner(ctx.role)) return { ok: false, error: "担当の表示設定を変更できるのは代表・管理者・営業マネージャーのみです" };

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("memberships")
    .update({ calendar_hidden: input.hidden })
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/opportunities");
  return { ok: true };
}
