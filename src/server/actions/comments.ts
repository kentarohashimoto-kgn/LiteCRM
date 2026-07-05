"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export interface OppComment {
  id: string;
  author_user_id: string;
  body: string;
  mentions: string[];
  created_at: string;
}

/** C-2 案件コメントを投稿。メンションがあればSlackへ通知(A-1連動、未設定なら送らない)。 */
export async function addOppCommentAction(input: {
  opportunityId: string;
  body: string;
  mentions: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "コメントが空です" };
  const mentions = (input.mentions ?? []).slice(0, 20);

  const { error } = await sb.from("opportunity_comments").insert({
    tenant_id: ctx.tenantId,
    opportunity_id: input.opportunityId,
    author_user_id: ctx.userId,
    body,
    mentions,
  });
  if (error) return { ok: false, error: error.message };

  // Slack通知(失敗しても投稿は成立させる)
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook && mentions.length > 0) {
    try {
      const [{ data: opp }, { data: profs }] = await Promise.all([
        sb.from("opportunities").select("name, accounts(name)").eq("id", input.opportunityId).maybeSingle(),
        sb.from("profiles").select("id, display_name, email").in("id", [...mentions, ctx.userId]),
      ]);
      const nameOf = new Map((profs ?? []).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || "—"]));
      const oppRow = opp as { name?: string; accounts?: { name?: string } | null } | null;
      const oppLabel = [oppRow?.accounts?.name, oppRow?.name].filter(Boolean).join("｜") || "案件";
      const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://litecrm.vercel.app"}/app/opportunities/${input.opportunityId}`;
      const to = mentions.map((m) => nameOf.get(m) ?? "—").join(" ");
      const text = `:speech_balloon: *${nameOf.get(ctx.userId) ?? ctx.email}* さんが *${to}* さんをメンションしました\n<${url}|${oppLabel}>\n> ${body.slice(0, 300)}`;
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch {
      /* 通知失敗は無視 */
    }
  }

  revalidatePath(`/app/opportunities/${input.opportunityId}`);
  return { ok: true };
}

/** コメント削除(本人 or 管理者。権限はRLSが担保)。 */
export async function deleteOppCommentAction(input: { id: string; opportunityId: string }): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("opportunity_comments").delete().eq("id", input.id);
  revalidatePath(`/app/opportunities/${input.opportunityId}`);
  return { ok: true };
}
