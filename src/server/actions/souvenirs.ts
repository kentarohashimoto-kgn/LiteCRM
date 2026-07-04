"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

function s(v: FormDataEntryValue | null): string | null {
  const t = v == null ? "" : String(v).trim();
  return t === "" ? null : t;
}

/** 顧客にお土産候補ソリューションを追加。 */
export async function addAccountSouvenirAction(formData: FormData) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const accountId = String(formData.get("account_id"));
  const packageId = s(formData.get("package_id"));
  if (accountId && packageId) {
    await sb.from("account_souvenirs").insert({
      tenant_id: ctx.tenantId,
      account_id: accountId,
      package_id: packageId,
      status: "candidate",
    });
  }
  revalidatePath(`/app/accounts/${accountId}`);
}

/** お土産の顧客反応・ステータス(候補/提示済/提案する/見送り)を更新。 */
export async function updateAccountSouvenirAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const accountId = String(formData.get("account_id"));
  await sb
    .from("account_souvenirs")
    .update({
      status: s(formData.get("status")) ?? "candidate",
      customer_reaction: s(formData.get("customer_reaction")),
      note: s(formData.get("note")),
    })
    .eq("id", id);
  revalidatePath(`/app/accounts/${accountId}`);
}

/** お土産候補を削除。 */
export async function deleteAccountSouvenirAction(formData: FormData) {
  await requireCtx();
  const sb = getSupabaseServer();
  const id = String(formData.get("id"));
  const accountId = String(formData.get("account_id"));
  await sb.from("account_souvenirs").delete().eq("id", id);
  revalidatePath(`/app/accounts/${accountId}`);
}
