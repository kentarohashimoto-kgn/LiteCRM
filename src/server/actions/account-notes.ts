"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/** 顧客メモを追加する。顧客詳細画面のメモ欄から呼ばれる。 */
export async function createAccountNoteAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  // プレゼンモード(デモテナント)では実データを書き換えない。
  if (ctx.isPresentation) return;

  const accountId = String(formData.get("account_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!accountId || !body) return;

  const sb = getSupabaseServer();
  await sb.from("account_notes").insert({
    tenant_id: ctx.tenantId,
    account_id: accountId,
    author_user_id: ctx.userId,
    title: title || null,
    body,
    kind: "general",
  });

  revalidatePath(`/app/accounts/${accountId}`);
}

/** 顧客メモを削除する。 */
export async function deleteAccountNoteAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (ctx.isPresentation) return;

  const id = String(formData.get("id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  if (!id) return;

  const sb = getSupabaseServer();
  await sb.from("account_notes").delete().eq("id", id);

  if (accountId) revalidatePath(`/app/accounts/${accountId}`);
}
