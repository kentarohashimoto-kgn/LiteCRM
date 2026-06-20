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
