"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { logAudit, clientIp } from "@/lib/audit-events";

/**
 * リードの対応者(FS接客者)判定(0177)。
 * 展示会では「獲得担当がQRスキャン → 社長/責任者がFS接客して名刺交換」の2段構えのため、
 * acquirer(獲得担当)とは別に「誰が接客したか」を (メモ一致 OR 名刺一致) の複合ルールで判定する。
 * 責任者接客はFitスコアにも加点される(軸 exec_touch)。
 */

const EDIT_ROLES = ["owner", "admin", "sales_manager"];

export interface HandlerRule {
  id?: string;
  handler_name: string;
  memo_pattern: string;
  memo_exclude: string;
  card_owner_user_id: string | null;
  card_from: string | null;
  priority: number;
  is_active: boolean;
}

export interface RunHandlerResult {
  ok: boolean;
  error?: string;
  cardsMatched?: { byEmail: number; byName: number };
  assigned?: number;
  cleared?: number;
  rescored?: number;
  distribution?: { name: string; leads: number }[];
}

/** 名刺⇔リードのマッチング → 対応者判定 → 全件再スコア をまとめて実行。 */
export async function runHandlerAssignmentAction(): Promise<RunHandlerResult> {
  const ctx = await requireCtx();
  if (!EDIT_ROLES.includes(ctx.role)) return { ok: false, error: "実行権限がありません（管理者・営業マネージャーのみ）" };
  const sb = getSupabaseServer();

  const { data: m, error: mErr } = await sb.rpc("match_cards_to_leads");
  if (mErr) return { ok: false, error: `名刺マッチングに失敗: ${mErr.message}` };

  const { data: a, error: aErr } = await sb.rpc("assign_lead_handlers");
  if (aErr) return { ok: false, error: `対応者の判定に失敗（パターンを確認してください）: ${aErr.message}` };

  const { data: r, error: rErr } = await sb.rpc("rescore_leads");
  if (rErr) return { ok: false, error: `再スコアに失敗: ${rErr.message}` };

  const { data: dist } = await sb.rpc("lead_handlers");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mm = (m ?? {}) as any;
  const aa = (a ?? {}) as any;
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "lead.assign_handlers", target: "leads", meta: { ...mm, ...aa }, ip: await clientIp() });
  revalidatePath("/app/leads");
  revalidatePath("/app/leads/scoring");
  return {
    ok: true,
    cardsMatched: { byEmail: mm.byEmail ?? 0, byName: mm.byName ?? 0 },
    assigned: aa.assigned ?? 0,
    cleared: aa.cleared ?? 0,
    rescored: (r as number) ?? 0,
    distribution: ((dist ?? []) as any[]).map((d) => ({ name: d.name as string, leads: d.leads ?? 0 })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 対応者の手修正(誤判定の是正)。source='manual' となり以後の自動判定で上書きされない。 */
export async function setLeadHandlerAction(input: { leadId: string; handlerName: string | null }): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const name = (input.handlerName ?? "").trim();
  const { error } = await sb
    .from("leads")
    .update({ handled_by: name || null, handled_by_source: "manual" })
    .eq("id", input.leadId)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  // 責任者接客はスコアに効くため単票を再計算
  try { await sb.rpc("rescore_leads", { p_lead_id: input.leadId }); } catch { /* 再スコアは再実行可 */ }
  revalidatePath("/app/leads");
  return { ok: true };
}

/** 対応者ルールの取得。 */
export async function listHandlerRulesAction(): Promise<{ rules: HandlerRule[]; members: { id: string; name: string }[]; handlers: { name: string; leads: number }[] }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const [rulesR, memR, handR] = await Promise.all([
    sb.from("lead_handler_rules").select("id, handler_name, memo_pattern, memo_exclude, card_owner_user_id, card_from, priority, is_active").order("priority"),
    sb.from("memberships").select("user_id, profiles!inner(display_name, email)").eq("status", "active"),
    sb.rpc("lead_handlers"),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    rules: ((rulesR.data ?? []) as any[]).map((r) => ({
      id: r.id, handler_name: r.handler_name ?? "", memo_pattern: r.memo_pattern ?? "", memo_exclude: r.memo_exclude ?? "",
      card_owner_user_id: r.card_owner_user_id ?? null, card_from: r.card_from ?? null,
      priority: r.priority ?? 100, is_active: !!r.is_active,
    })),
    members: ((memR.data ?? []) as any[]).map((m) => ({
      id: m.user_id as string,
      name: (m.profiles?.display_name as string) || (m.profiles?.email as string) || "",
    })).filter((m) => m.name),
    handlers: ((handR.data ?? []) as any[]).map((h) => ({ name: h.name as string, leads: h.leads ?? 0 })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 対応者ルールの保存(全置換)。保存後は実行ボタンで判定を反映する。 */
export async function saveHandlerRulesAction(rules: HandlerRule[]): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCtx();
  if (!EDIT_ROLES.includes(ctx.role)) return { ok: false, error: "編集権限がありません（管理者・営業マネージャーのみ）" };
  for (const r of rules) {
    if (!r.handler_name.trim()) return { ok: false, error: "対応者名が空の行があります" };
    if (!r.memo_pattern.trim() && !r.card_owner_user_id) return { ok: false, error: `「${r.handler_name}」はメモパターンか名刺の交換者のどちらかが必要です` };
    for (const [label, pat] of [["メモパターン", r.memo_pattern], ["除外パターン", r.memo_exclude]] as const) {
      if (pat.trim()) {
        try { new RegExp(pat); }
        catch { return { ok: false, error: `「${r.handler_name}」の${label}が不正です: ${pat}` }; }
      }
    }
  }
  const sb = getSupabaseServer();
  const { error: delErr } = await sb.from("lead_handler_rules").delete().eq("tenant_id", ctx.tenantId);
  if (delErr) return { ok: false, error: `更新に失敗: ${delErr.message}` };
  if (rules.length > 0) {
    const { error } = await sb.from("lead_handler_rules").insert(rules.map((r, i) => ({
      tenant_id: ctx.tenantId,
      handler_name: r.handler_name.trim().slice(0, 60),
      memo_pattern: r.memo_pattern.trim() || null,
      memo_exclude: r.memo_exclude.trim() || null,
      card_owner_user_id: r.card_owner_user_id,
      card_from: r.card_from || null,
      priority: (i + 1) * 10,
      is_active: r.is_active,
    })));
    if (error) return { ok: false, error: `保存に失敗: ${error.message}` };
  }
  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "lead.handler_rules.save", target: "lead_handler_rules", meta: { rules: rules.length }, ip: await clientIp() });
  revalidatePath("/app/leads/scoring");
  return { ok: true };
}
