"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { generateAndSavePmoReport } from "@/lib/data/pmo";
import type { PmoMode } from "@/lib/pmo";

/**
 * AI-PMO: CRM横断データを収集し、ベテランPMアドバイザーとしての
 * レポート(振り返りPDCA/未来段取り/案件PJ管理/経営俯瞰)を生成して保存する。
 * 生成コアは夜間バッチ(/api/cron/pmo-nightly)と共有(src/lib/data/pmo.ts)。
 */
export async function generatePmoReportAction(input: {
  mode: PmoMode;
  memo?: string;
}): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const ctx = await requireCtx();
  const res = await generateAndSavePmoReport({
    sb: getSupabaseServer(),
    tenantId: ctx.tenantId,
    mode: input.mode,
    memo: input.memo,
    createdBy: ctx.userId,
    trigger: "manual",
  });
  if (res.ok) revalidatePath("/app/pmo");
  return res;
}

/** レポート削除(owner/adminのみRLSで許可)。 */
export async function deletePmoReportAction(input: { reportId: string }): Promise<{ ok: boolean; error?: string }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("pmo_reports").delete().eq("id", input.reportId);
  if (error) return { ok: false, error: "削除に失敗しました" };
  revalidatePath("/app/pmo");
  return { ok: true };
}
