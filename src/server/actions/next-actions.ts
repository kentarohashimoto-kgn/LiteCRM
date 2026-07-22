"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * 案件に手動でネクストアクションを1件追加する（tasks.origin='next_action'・商談紐付けなし）。
 * 案件のネクストアクションは複数持てる。表示は「未完了で最も近い期日」を代表として出す。
 */
export async function addOpportunityNextActionAction(input: {
  opportunityId: string;
  date: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const date = (input.date || "").trim();
  if (!date) return { ok: false, error: "次アクション日を入力してください" };
  const title = (input.text || "").trim() || "次回アクション";

  const { data: o } = await sb
    .from("opportunities")
    .select("account_id, owner_user_id")
    .eq("id", input.opportunityId)
    .maybeSingle();

  const { error } = await sb.from("tasks").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: input.opportunityId,
    account_id: (o?.account_id as string | null) ?? null,
    assigned_to: (o?.owner_user_id as string | null) ?? ctx.userId,
    created_by: ctx.userId,
    title,
    due_date: date,
    status: "todo",
    priority: "middle",
    origin: "next_action",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/opportunities/${input.opportunityId}`);
  revalidatePath("/app/tasks");
  return { ok: true };
}
