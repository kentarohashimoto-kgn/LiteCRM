"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export interface TrashRow {
  id: string;
  title: string;
  sub: string | null;
  deleted_at: string;
  deleted_by_name: string;
}

export interface TrashData {
  leads: TrashRow[];
  opportunities: TrashRow[];
  accounts: TrashRow[];
}

export type TrashKind = "lead" | "opportunity" | "account";

/** ゴミ箱の中身(種別ごと最新200件)。 */
export async function fetchTrashAction(): Promise<TrashData> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("trash_list");
  if (error || !data) return { leads: [], opportunities: [], accounts: [] };
  return data as unknown as TrashData;
}

/** 案件を論理削除(30日間はゴミ箱から復元可能)。
 *  論理削除は SECURITY DEFINER RPC 経由。RLS 適用クライアントの直接 update だと
 *  SELECT ポリシーの deleted_at is null により更新後の行が拒否され、削除が効かないため。 */
export async function deleteOpportunityAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  await sb.rpc("trash_soft_delete", { p_kind: "opportunity", p_id: id });
  revalidatePath("/app/opportunities");
  redirect("/app/opportunities");
}

/** 顧客を論理削除。案件(削除済みを除く)が紐づく場合は削除不可。 */
export async function deleteAccountAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const { count } = await sb
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id)
    .eq("tenant_id", ctx.tenantId);
  if ((count ?? 0) > 0) {
    redirect(`/app/accounts/${id}?error=` + encodeURIComponent(`案件が${count}件紐づいているため削除できません。先に案件を削除してください。`));
  }
  await sb.rpc("trash_soft_delete", { p_kind: "account", p_id: id });
  revalidatePath("/app/accounts");
  redirect("/app/accounts");
}

/** ゴミ箱から復元。 */
export async function restoreTrashAction(input: { kind: TrashKind; id: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("trash_restore", { p_kind: input.kind, p_id: input.id });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "復元できませんでした(権限不足の可能性があります)" };
  revalidatePath("/app/settings/trash");
  return { ok: true };
}

/** ゴミ箱から完全削除(owner/adminのみ)。 */
export async function purgeTrashAction(input: { kind: TrashKind; id: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("trash_purge", { p_kind: input.kind, p_id: input.id });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "完全削除できませんでした(権限不足か、関連データが残っています)" };
  revalidatePath("/app/settings/trash");
  return { ok: true };
}
