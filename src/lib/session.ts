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

  // プレゼンモード: Cookie がヒント。実際の可否は presentation_sessions(DB)を真とする。
  // これにより RLS(current_tenant_ids)とアプリの判定が食い違わない。
  const presentationHint = (await cookies()).get(PRESENTATION_COOKIE)?.value === "1";
  if (presentationHint) {
    const { data: sess } = await supabase
      .from("presentation_sessions")
      .select("expires_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const active = sess?.expires_at ? new Date(sess.expires_at as string) > new Date() : false;
    if (active) {
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
    }
    // セッション無効 or デモ未参加 → 通常テナントにフォールバック。
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

/**
 * 管理者(代表/管理者)専用ページで使用。権限がなければマイページへ。
 * マインドマップなど「橋本個人の段取り」機能はこのゲートで囲う(DB側もRLSで二重に遮断)。
 */
export async function requireAdminCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["owner", "admin"].includes(ctx.role)) redirect("/app/mypage");
  return ctx;
}

/**
 * 全社の営業数字を扱うページ(ダッシュボード・分析・予測・週報・AI-PMO等)で使用。
 * inside_sales はマイページへ、BO専任(事務/人事)はBOトップへ。
 * DB側も 0170 の can_view_sales_numbers で二重に遮断している(RPC直叩き対策)。
 */
export async function requireSalesNumbersCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (ctx.role === "back_office" || ctx.role === "hr") redirect("/app/bo");
  if (ctx.role === "inside_sales") redirect("/app/mypage");
  return ctx;
}

/** BO領域(事務/人事/管理者)専用ページで使用。権限がなければマイページへ。 */
export async function requireBoCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["back_office", "hr", "owner", "admin"].includes(ctx.role)) redirect("/app/mypage");
  return ctx;
}

/** 人事領域(人事/管理者)専用ページで使用。権限がなければBOトップへ。 */
export async function requireHrCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["hr", "owner", "admin"].includes(ctx.role)) redirect("/app/bo");
  return ctx;
}

/** 案件管理(デリバリー原価・粗利管理)専用ページで使用。管理職以外はマイページへ。 */
export async function requireProjectCtx(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["owner", "admin", "sales_manager", "finance", "delivery"].includes(ctx.role)) redirect("/app/mypage");
  return ctx;
}
