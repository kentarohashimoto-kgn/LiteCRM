"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx, getCtxOrNull, PRESENTATION_COOKIE } from "@/lib/session";

// Cookie 有効期限(秒)。プレゼン後に切り忘れても半日で自動的に通常モードへ戻る。
const MAX_AGE = 60 * 60 * 12;

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * プレゼンモード開始。
 * デモテナントへ sales_manager として参加させ、プレゼンター枠のポートフォリオを本人に付替える。
 * 実データ(本番テナント)には一切影響しない。
 */
export async function enterPresentationMode() {
  await requireCtx(); // 本番テナントのログインメンバーであることを保証
  const sb = getSupabaseServer();
  const { error } = await sb.rpc("enter_presentation_mode");
  if (error) throw new Error(`プレゼンモード開始に失敗しました: ${error.message}`);
  cookies().set(PRESENTATION_COOKIE, "1", { ...cookieOpts(), maxAge: MAX_AGE });
  redirect("/app/dashboard");
}

/** プレゼンモード終了。付替えたポートフォリオをデモ枠へ戻し、通常テナントへ復帰。 */
export async function exitPresentationMode() {
  const sb = getSupabaseServer();
  // Cookie の有無に関わらず付替えは元に戻す(冪等)。
  const { error } = await sb.rpc("exit_presentation_mode");
  cookies().delete(PRESENTATION_COOKIE);
  if (error) throw new Error(`プレゼンモード終了に失敗しました: ${error.message}`);
  redirect("/app/dashboard");
}

/**
 * デモデータを初期化(相対日付で再生成)。プレゼン中の編集を原状回復する。
 * プレゼンモード時のみ実行可能。デモテナント配下のみを再生成する。
 */
export async function resetDemoData() {
  const ctx = await getCtxOrNull();
  if (!ctx?.isPresentation) {
    throw new Error("デモの初期化はプレゼンモード中のみ実行できます。");
  }
  const sb = getSupabaseServer();
  const { error } = await sb.rpc("reset_demo_tenant_guarded");
  if (error) throw new Error(`デモ初期化に失敗しました: ${error.message}`);
  // 再生成でポートフォリオがデモ枠に戻るため、プレゼンターへ再度付替える。
  await sb.rpc("enter_presentation_mode");
  redirect("/app/dashboard");
}
