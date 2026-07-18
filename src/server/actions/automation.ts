"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { RECIPE_MAP } from "@/lib/automation";

const ADMIN_ROLES = ["owner", "admin"];

/**
 * WO-18 ワークフロー自動化(F-102)の設定操作。
 * ルールの作成(レシピから)・有効/停止・削除。owner/admin のみ。
 * 実際の発火は /api/cron/automation(バッチ)が行う。
 */

/** レシピ・カタログから新規ルールを作成する。 */
export async function createRuleFromRecipeAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/automation?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  const recipeKey = String(formData.get("recipe_key") ?? "").trim();
  const recipe = RECIPE_MAP[recipeKey];
  if (!recipe) back("error=invalid");

  const sb = getSupabaseServer();
  // 同じレシピの重複作成を避ける(同一テナントに1つ)
  const existing = await sb
    .from("automation_rules")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("recipe_key", recipeKey)
    .maybeSingle();
  if (existing.data) back("error=duplicate");

  const ins = await sb.from("automation_rules").insert({
    tenant_id: ctx.tenantId,
    name: recipe!.name,
    recipe_key: recipe!.key,
    trigger_type: recipe!.trigger_type,
    condition_json: recipe!.condition_json,
    action_json: recipe!.action_json,
    enabled: false, // 作成直後は停止。内容を確認してから有効化。
    created_by: ctx.userId,
  });
  if (ins.error) back("error=save_failed");

  revalidatePath("/app/automation");
  back("saved=created");
}

/** ルールの有効/停止を切り替える。 */
export async function toggleRuleAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/automation?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  const to = String(formData.get("to") ?? "") === "start";
  if (!id) back("error=invalid");

  const sb = getSupabaseServer();
  // 有効化時は走査基準を「今」に進める。過去ログの一斉バックフィル(Slack大量発火)を防ぎ、
  // 有効化以降の新規変更のみ発火させる。停止時は基準を触らない。
  const patch: { enabled: boolean; last_evaluated_at?: string } = { enabled: to };
  if (to) patch.last_evaluated_at = new Date().toISOString();
  const up = await sb
    .from("automation_rules")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (up.error || !up.data?.length) back("error=save_failed");

  revalidatePath("/app/automation");
  back(to ? "saved=started" : "saved=stopped");
}

/** ルールを削除する。 */
export async function deleteRuleAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/automation?${q}`);
  if (!ADMIN_ROLES.includes(ctx.role)) back("error=forbidden");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("error=invalid");

  const sb = getSupabaseServer();
  const del = await sb.from("automation_rules").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (del.error) back("error=save_failed");

  revalidatePath("/app/automation");
  back("saved=deleted");
}
