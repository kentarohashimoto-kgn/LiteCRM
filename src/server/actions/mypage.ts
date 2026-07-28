"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { normalizeLayout, type MypageLayout } from "@/lib/mypage";

export type MypageResult = { ok: true } | { ok: false; error: string };

/**
 * マイページのレイアウト保存(1ユーザー×1テナントで1行upsert)。
 * 入力はロールに合わせて正規化してから保存する(権限外ガジェットの持ち込み防止)。
 * RLSでも本人以外の行は読み書き不可。
 */
export async function saveMypageLayoutAction(input: MypageLayout): Promise<MypageResult> {
  const ctx = await requireCtx();
  const layout = normalizeLayout(input, ctx.role);
  const sb = getSupabaseServer();
  const { error } = await sb.from("user_home_layouts").upsert(
    { tenant_id: ctx.tenantId, user_id: ctx.userId, layout, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,user_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/mypage");
  return { ok: true };
}

/** マイページを初期配置に戻す(保存行を削除 → ロール別デフォルトが適用される)。 */
export async function resetMypageLayoutAction(): Promise<MypageResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb
    .from("user_home_layouts")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/mypage");
  return { ok: true };
}
