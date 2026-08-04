"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { logAudit, clientIp } from "@/lib/audit-events";

export interface DupAccountItem {
  id: string;
  name: string;
  industry: string | null;
  rank: string | null;
  created_at: string;
  opp_count: number;
}

export interface DupLeadItem {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  raw_event: string | null;
  rank: string | null;
  acquired_at: string | null;
  created_at: string;
  opp_count: number;
}

export interface DupGroup<T> {
  key: string;
  items: T[];
}

/** B-3 重複候補: 顧客(会社名の正規化一致)。 */
export async function fetchDupAccountsAction(): Promise<DupGroup<DupAccountItem>[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("dup_candidate_accounts");
  if (error || !data) return [];
  return data as unknown as DupGroup<DupAccountItem>[];
}

/** B-3 重複候補: リード(メールアドレス一致)。 */
export async function fetchDupLeadsAction(): Promise<DupGroup<DupLeadItem>[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("dup_candidate_leads");
  if (error || !data) return [];
  return data as unknown as DupGroup<DupLeadItem>[];
}

interface MergeResult { ok: boolean; error?: string; moved?: number; merged?: number; }

/** 顧客をマージ(owner/adminのみ)。重複側の案件・商談・活動等は残す側へ付け替え、本体はゴミ箱へ。 */
export async function mergeAccountsAction(input: { primaryId: string; dupIds: string[] }): Promise<MergeResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("merge_accounts", { p_primary: input.primaryId, p_dups: input.dupIds });
  if (error) return { ok: false, error: error.message };
  const r = data as unknown as MergeResult;
  if (r.ok) {
    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId, email: ctx.email,
      action: "accounts.merge", target: `統合先${input.primaryId} ← ${input.dupIds.length}件`,
      meta: { primaryId: input.primaryId, dupCount: input.dupIds.length }, ip: await clientIp(),
    });
    revalidatePath("/app/accounts");
    revalidatePath("/app/settings/duplicates");
  }
  return r;
}

/** リードをマージ(owner/adminのみ)。 */
export async function mergeLeadsAction(input: { primaryId: string; dupIds: string[] }): Promise<MergeResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("merge_leads", { p_primary: input.primaryId, p_dups: input.dupIds });
  if (error) return { ok: false, error: error.message };
  const r = data as unknown as MergeResult;
  if (r.ok) {
    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId, email: ctx.email,
      action: "leads.merge", target: `統合先${input.primaryId} ← ${input.dupIds.length}件`,
      meta: { primaryId: input.primaryId, dupCount: input.dupIds.length }, ip: await clientIp(),
    });
    revalidatePath("/app/leads");
    revalidatePath("/app/settings/duplicates");
  }
  return r;
}
