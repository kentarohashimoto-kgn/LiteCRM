"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string; id?: string };

const DECISION_ROLES = new Set(["decision_maker", "influencer", "user", "referrer"]);

/** 空文字を null に。前後空白は除去。 */
function nn(v?: string | null): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}
function role(v?: string | null): string | null {
  const t = (v ?? "").trim();
  return DECISION_ROLES.has(t) ? t : null;
}

export interface ContactInput {
  name: string;
  department?: string;
  title?: string;
  phone?: string;
  email?: string;
  notes?: string;
  decisionRole?: string;
}

function revalidate(opportunityId?: string, accountId?: string) {
  if (opportunityId) revalidatePath(`/app/opportunities/${opportunityId}`);
  if (accountId) revalidatePath(`/app/accounts/${accountId}`);
  revalidatePath("/app/contacts");
}

/**
 * 顧客(account)に担当者(窓口/アカウンター候補)を追加する。
 * setAccounter=true かつ opportunityId 指定時は、その案件のアカウンターにも設定する。
 * 書込可否は contacts の RLS(can_edit_role＋担当案件所有)で担保。
 */
export async function createContactAction(
  input: ContactInput & { accountId: string; opportunityId?: string; setAccounter?: boolean },
): Promise<Result> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "氏名を入力してください" };
  if (!input.accountId) return { ok: false, error: "顧客が特定できません" };

  const { data, error } = await sb
    .from("contacts")
    .insert({
      tenant_id: ctx.tenantId,
      account_id: input.accountId,
      name,
      department: nn(input.department),
      title: nn(input.title),
      phone: nn(input.phone),
      email: nn(input.email),
      notes: nn(input.notes),
      decision_role: role(input.decisionRole),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "担当者の追加に失敗しました" };

  if (input.setAccounter && input.opportunityId) {
    await sb.from("opportunities").update({ contact_id: data.id }).eq("id", input.opportunityId);
  }
  revalidate(input.opportunityId, input.accountId);
  return { ok: true, id: data.id as string };
}

/** 担当者の情報(部署・役職・氏名・電話・メール・メモ・役割)を更新する。 */
export async function updateContactAction(
  input: ContactInput & { id: string; opportunityId?: string; accountId?: string },
): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  const name = (input.name || "").trim();
  if (!input.id) return { ok: false, error: "対象が不明です" };
  if (!name) return { ok: false, error: "氏名を入力してください" };

  const { error } = await sb
    .from("contacts")
    .update({
      name,
      department: nn(input.department),
      title: nn(input.title),
      phone: nn(input.phone),
      email: nn(input.email),
      notes: nn(input.notes),
      decision_role: role(input.decisionRole),
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidate(input.opportunityId, input.accountId);
  return { ok: true };
}

/** 担当者を削除する(owner/adminのみ・RLS)。参照している案件のアカウンターは外す。 */
export async function deleteContactAction(input: { id: string; opportunityId?: string; accountId?: string }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  if (!input.id) return { ok: false, error: "対象が不明です" };
  // FK(opportunities.contact_id) を先に外してから削除する
  await sb.from("opportunities").update({ contact_id: null }).eq("contact_id", input.id);
  const { error } = await sb.from("contacts").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidate(input.opportunityId, input.accountId);
  return { ok: true };
}

/** 案件のアカウンター(窓口担当者)を設定/解除する(型付き・{ok}を返す版)。 */
export async function setAccounterAction(input: { opportunityId: string; contactId: string | null }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  if (!input.opportunityId) return { ok: false, error: "案件が特定できません" };
  if (input.contactId) {
    const [oppR, cR] = await Promise.all([
      sb.from("opportunities").select("account_id").eq("id", input.opportunityId).maybeSingle(),
      sb.from("contacts").select("account_id").eq("id", input.contactId).maybeSingle(),
    ]);
    const oa = (oppR.data as { account_id: string } | null)?.account_id;
    const ca = (cR.data as { account_id: string } | null)?.account_id;
    if (!oa || !ca || oa !== ca) return { ok: false, error: "別の顧客の担当者は設定できません" };
  }
  const { error } = await sb.from("opportunities").update({ contact_id: input.contactId }).eq("id", input.opportunityId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/app/opportunities/${input.opportunityId}`);
  return { ok: true };
}
