import { cache } from "react";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export interface Ctx {
  userId: string;
  role: Role;
  tenantId: string;
  email: string;
}

/**
 * 現在のログインユーザーのコンテキストを取得。
 * Supabase Auth のユーザー + memberships(所属テナント/ロール) から構築。
 * 未ログイン or 所属なしは null。
 */
export const getCtxOrNull = cache(async (): Promise<Ctx | null> => {
  const supabase = getSupabaseServer();
  // セッションはCookieからローカルに復元(ネットワーク往復なし)。
  // トークンの正当性検証・リフレッシュは middleware の getUser() が担保する。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;

  const { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return {
    userId: user.id,
    role: membership.role as Role,
    tenantId: membership.tenant_id as string,
    email: user.email ?? "",
  };
});

/** 認証必須のページで使用。未ログインなら /login へ。 */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtxOrNull();
  if (!ctx) redirect("/login");
  return ctx;
}

/** BO領域(事務/人事/管理者)専用ページで使用。権限がなければ営業トップへ。 */
export async function requireBoCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["back_office", "hr", "owner", "admin"].includes(ctx.role)) redirect("/app/dashboard");
  return ctx;
}

/** 人事領域(人事/管理者)専用ページで使用。権限がなければBOトップへ。 */
export async function requireHrCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["hr", "owner", "admin"].includes(ctx.role)) redirect("/app/bo");
  return ctx;
}

/** 案件管理(デリバリー原価・粗利管理)専用ページで使用。管理職以外は営業トップへ。 */
export async function requireProjectCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager", "finance", "delivery"].includes(ctx.role)) redirect("/app/dashboard");
  return ctx;
}

/** 経理領域(経理/代表/管理者)専用ページで使用。freee連携・請求まわり。権限なしは営業トップへ。 */
export async function requireFinanceCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["finance", "owner", "admin"].includes(ctx.role)) redirect("/app/dashboard");
  return ctx;
}

/** 現在のロールが経理領域(freee連携・請求)を扱えるか。 */
export function canManageFinance(role: Role): boolean {
  return ["finance", "owner", "admin"].includes(role);
}
