"use server";

import { revalidatePath } from "next/cache";
import { getConversation, labDb } from "@/lib/ai-lab/db";
import { getLabCtx } from "@/lib/ai-lab/session";

/**
 * 受講者が自分の会話に対して行う操作(リネーム・削除)。
 * 会話は必ず「自分のもの」として引き直してから更新する(他人のIDを渡されても何も起きない)。
 */

export async function renameLabConversation(input: {
  slug: string;
  conversationId: string;
  title: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getLabCtx(input.slug);
  if (!ctx) return { ok: false, error: "セッションが切れました。再度ログインしてください。" };

  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) return { ok: false, error: "タイトルを入力してください" };

  const conv = await getConversation(ctx.user.id, input.conversationId);
  if (!conv) return { ok: false, error: "会話が見つかりません" };

  await labDb().from("ai_lab_conversations").update({ title }).eq("id", conv.id).eq("user_id", ctx.user.id);
  revalidatePath(`/lab/${input.slug}/chat`);
  return { ok: true };
}

/** 削除は論理削除。管理者の利用ログには残す(研修の振り返りに使うため)。 */
export async function archiveLabConversation(input: {
  slug: string;
  conversationId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getLabCtx(input.slug);
  if (!ctx) return { ok: false, error: "セッションが切れました。再度ログインしてください。" };

  const conv = await getConversation(ctx.user.id, input.conversationId);
  if (!conv) return { ok: false, error: "会話が見つかりません" };

  await labDb()
    .from("ai_lab_conversations")
    .update({ is_archived: true })
    .eq("id", conv.id)
    .eq("user_id", ctx.user.id);
  revalidatePath(`/lab/${input.slug}/chat`);
  return { ok: true };
}
