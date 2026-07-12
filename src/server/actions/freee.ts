"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  importPartners,
  applyPartnerDecision,
  createQuoteDraft,
  issueQuote,
  recordAcceptanceAndDraft,
  issueInvoice,
  syncPayments,
} from "@/lib/freee/sync";
import { FreeeNotConnectedError } from "@/lib/freee/client";
import type { PartnerMatch, LinkDecision } from "@/lib/freee/types";
import type { Ctx } from "@/lib/session";

type Result = { ok: boolean; error?: string };

/** 経理領域（経理/代表/管理者）のみ。見積・請求・接続を操作できる。 */
async function requireFinance(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!["finance", "owner", "admin"].includes(ctx.role)) {
    throw new Error("この操作は経理(finance)・代表・管理者のみ実行できます");
  }
  return ctx;
}

/** 発行（freeeへ書き込む）操作。承認者（経理/代表/管理者）に限定。 */
async function requireApprover(): Promise<Ctx> {
  return requireFinance();
}

function toMessage(e: unknown): string {
  if (e instanceof FreeeNotConnectedError) return e.message;
  return e instanceof Error ? e.message : "エラーが発生しました";
}

// ===================== 接続 =====================

/** 接続を解除（トークンを破棄）。 */
export async function disconnectFreeeAction(): Promise<Result> {
  const ctx = await requireFinance();
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("freee_connections").delete().eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings/freee");
  return { ok: true };
}

// ===================== マスタ名寄せ =====================

/** freee取引先を取得し、CRM顧客との名寄せ候補を返す（書き込みなし）。 */
export async function importFreeePartnersAction(): Promise<{ ok: boolean; error?: string; matches?: PartnerMatch[] }> {
  await requireFinance();
  const ctx = await requireCtx();
  try {
    const matches = await importPartners(ctx.tenantId);
    return { ok: true, matches };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

/** 名寄せの意思決定を反映（renamed=名称変更 / linked=外部キー接続のみ）。 */
export async function applyPartnerDecisionAction(input: { account_id: string; freee_id: number; freee_name: string; mode: "renamed" | "linked" }): Promise<Result> {
  const ctx = await requireFinance();
  try {
    await applyPartnerDecision(ctx.tenantId, ctx.userId, input as LinkDecision);
    revalidatePath("/app/settings/freee");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

// ===================== 見積（下書き→発行） =====================

/** 案件から見積の下書きを作成（freeeは未接触）。 */
export async function createQuoteDraftAction(input: { opportunity_id: string }): Promise<Result> {
  const ctx = await requireFinance();
  try {
    await createQuoteDraft(ctx.tenantId, ctx.userId, input.opportunity_id);
    revalidatePath(`/app/opportunities/${input.opportunity_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

/** 見積下書きを承認して freee へ発行。 */
export async function issueQuoteAction(input: { quote_id: string; opportunity_id: string }): Promise<Result> {
  const ctx = await requireApprover();
  try {
    await issueQuote(ctx.tenantId, ctx.userId, input.quote_id);
    revalidatePath(`/app/opportunities/${input.opportunity_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

// ===================== 検収 → 請求（下書き→発行） =====================

/** 請求予定に検収を記録し、請求書の下書きを生成する。 */
export async function recordAcceptanceAction(input: { billing_schedule_id: string; opportunity_id: string; accepted_on: string }): Promise<Result> {
  const ctx = await requireFinance();
  if (!input.accepted_on) return { ok: false, error: "検収日を入力してください" };
  try {
    await recordAcceptanceAndDraft(ctx.tenantId, ctx.userId, input.billing_schedule_id, input.accepted_on);
    revalidatePath(`/app/opportunities/${input.opportunity_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

/** 請求下書きを承認して freee へ発行。 */
export async function issueInvoiceAction(input: { invoice_id: string; opportunity_id: string }): Promise<Result> {
  const ctx = await requireApprover();
  try {
    await issueInvoice(ctx.tenantId, ctx.userId, input.invoice_id);
    revalidatePath(`/app/opportunities/${input.opportunity_id}`);
    revalidatePath("/app/settings/freee");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

// ===================== 入金同期 =====================

/** 発行済み請求書の入金状況を freee から取り込む。 */
export async function syncFreeePaymentsAction(): Promise<{ ok: boolean; error?: string; updated?: number }> {
  const ctx = await requireFinance();
  try {
    const updated = await syncPayments(ctx.tenantId, ctx.userId);
    revalidatePath("/app/settings/freee");
    return { ok: true, updated };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}
