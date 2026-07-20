import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

/** プレゼンモード判定に使う Cookie 名。値が "1" のときデモテナントで動作する。 */
export const PRESENTATION_COOKIE = "catorce_presentation";

export interface Ctx {
  userId: string;
  role: Role;
  tenantId: string;
  email: string;
  /** プレゼンモード(デモテナントで動作中)なら true。バナー表示・送信抑止に使う。 */
  isPresentation: boolean;
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

  // プレゼンモード: Cookie が立っていて、かつデモテナントに参加している場合は
  // デモテナントの membership を採用する(全画面が無改修でダミーデータに切り替わる)。
  const presentationOn = cookies().get(PRESENTATION_COOKIE)?.value === "1";
  if (presentationOn) {
    const { data: demo } = await supabase
      .from("memberships")
      .select("tenant_id, role, tenants!inner(is_demo)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("tenants.is_demo", true)
      .limit(1)
      .maybeSingle();
    if (demo) {
      return {
        userId: user.id,
        role: demo.role as Role,
        tenantId: demo.tenant_id as string,
        email: user.email ?? "",
        isPresentation: true,
      };
    }
    // Cookie は立っているがデモ未参加 → 通常テナントにフォールバック。
  }

  // 通常モード: デモテナントは明示的に除外する。
  // (単一の実テナントでも .limit(1) の非決定性でデモを掴まないための安全策)
  const { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id, role, tenants!inner(is_demo)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .eq("tenants.is_demo", false)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return {
    userId: user.id,
    role: membership.role as Role,
    tenantId: membership.tenant_id as string,
    email: user.email ?? "",
    isPresentation: false,
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
