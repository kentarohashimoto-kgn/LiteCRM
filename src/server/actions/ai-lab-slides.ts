"use server";

import { revalidatePath } from "next/cache";
import { getLabCtx } from "@/lib/ai-lab/session";
import { deleteDeck, getDeck, getSlideItem, updateDeck, updateSlideItem } from "@/lib/ai-lab/slides-db";

/**
 * 構成案の編集。
 *
 * 画像生成の前にここを直せることが、このフローの肝。
 * 10枚の生成には数分と実費がかかるので、方向性がずれたまま走らせない。
 */

export async function renameSlideDeckAction(params: {
  slug: string;
  deckId: string;
  title: string;
}): Promise<{ ok: boolean }> {
  const ctx = await getLabCtx(params.slug);
  if (!ctx) return { ok: false };
  const deck = await getDeck(ctx.user.id, params.deckId);
  if (!deck) return { ok: false };

  const title = params.title.trim().slice(0, 120);
  if (!title) return { ok: false };
  await updateDeck(deck.id, { title });
  revalidatePath(`/lab/${params.slug}/slides/${deck.id}`);
  return { ok: true };
}

export async function updateSlideItemAction(params: {
  slug: string;
  deckId: string;
  position: number;
  title: string;
  summary: string;
  imagePrompt: string;
  notes: string;
}): Promise<{ ok: boolean }> {
  const ctx = await getLabCtx(params.slug);
  if (!ctx) return { ok: false };
  const deck = await getDeck(ctx.user.id, params.deckId);
  if (!deck) return { ok: false };

  const item = await getSlideItem(deck.id, params.position);
  if (!item) return { ok: false };

  await updateSlideItem(item.id, {
    title: params.title.trim().slice(0, 120) || item.title,
    summary: params.summary.trim().slice(0, 400) || null,
    image_prompt: params.imagePrompt.trim().slice(0, 4000) || item.image_prompt,
    notes: params.notes.trim().slice(0, 2000) || null,
    // 内容を変えたら、生成済みでも「作り直しが要る」状態に戻す。
    ...(item.status === "done" ? { status: "pending" as const } : {}),
  });
  revalidatePath(`/lab/${params.slug}/slides/${deck.id}`);
  return { ok: true };
}

export async function deleteSlideDeckAction(params: { slug: string; deckId: string }): Promise<{ ok: boolean }> {
  const ctx = await getLabCtx(params.slug);
  if (!ctx) return { ok: false };
  await deleteDeck(ctx.user.id, params.deckId);
  revalidatePath(`/lab/${params.slug}/slides`);
  return { ok: true };
}
