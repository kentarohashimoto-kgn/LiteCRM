"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { logAudit, clientIp } from "@/lib/audit-events";

/**
 * リードスコアリング設計(F-201)。軸のcap・ルールの編集 → 保存 → 全件再スコア。
 * ルールは lead_scoring_rules / 軸は lead_scoring_axes(0174)。rescore_leads がルール駆動で評価する。
 */

const EDIT_ROLES = ["owner", "admin", "sales_manager"];
import { MATCH_KINDS, REGEX_KINDS } from "@/lib/scoring";

export interface AxisInput { axis: string; label: string; cap: number }
export interface RuleInput {
  axis: string; label: string; match_kind: string; match_value: string;
  points: number; sort_order: number; is_active: boolean;
}
export interface SaveScoringResult {
  ok: boolean;
  error?: string;
  rescored?: number;
  distribution?: Record<string, number>; // rank -> 件数(再スコア後)
}

export async function saveScoringConfigAction(axes: AxisInput[], rules: RuleInput[]): Promise<SaveScoringResult> {
  const ctx = await requireCtx();
  if (!EDIT_ROLES.includes(ctx.role)) return { ok: false, error: "スコア設計の編集権限がありません（管理者・営業マネージャーのみ）" };
  const sb = getSupabaseServer();

  // ---- 入力検証 ----
  const validKinds = new Set(MATCH_KINDS.map((k) => k.key as string));
  const validAxes = new Set(axes.map((a) => a.axis));
  for (const a of axes) {
    if (!a.label.trim()) return { ok: false, error: "軸の名前が空です" };
    if (!Number.isInteger(a.cap) || a.cap < 0 || a.cap > 100) return { ok: false, error: `軸「${a.label}」の上限点は0〜100で指定してください` };
  }
  for (const r of rules) {
    if (!validAxes.has(r.axis)) return { ok: false, error: `ルール「${r.label}」の軸が不正です` };
    if (!validKinds.has(r.match_kind)) return { ok: false, error: `ルール「${r.label}」の条件種別が不正です` };
    if (!r.label.trim()) return { ok: false, error: "ルール名が空の行があります" };
    if (!r.match_value.trim()) return { ok: false, error: `ルール「${r.label}」の条件値が空です` };
    if (!Number.isInteger(r.points) || r.points < -100 || r.points > 100) return { ok: false, error: `ルール「${r.label}」の点数は-100〜100で指定してください` };
    if (REGEX_KINDS.has(r.match_kind)) {
      try { new RegExp(r.match_value); }
      catch { return { ok: false, error: `ルール「${r.label}」のパターンが不正です: ${r.match_value}` }; }
    }
  }

  // ---- 保存(軸のcap/label更新 → ルール全置換) ----
  for (const a of axes) {
    const { error } = await sb.from("lead_scoring_axes").update({ label: a.label.trim().slice(0, 60), cap: a.cap }).eq("tenant_id", ctx.tenantId).eq("axis", a.axis);
    if (error) return { ok: false, error: `軸の保存に失敗: ${error.message}` };
  }
  const { error: delErr } = await sb.from("lead_scoring_rules").delete().eq("tenant_id", ctx.tenantId);
  if (delErr) return { ok: false, error: `ルールの更新に失敗: ${delErr.message}` };
  if (rules.length > 0) {
    const { error: insErr } = await sb.from("lead_scoring_rules").insert(rules.map((r, i) => ({
      tenant_id: ctx.tenantId,
      axis: r.axis, label: r.label.trim().slice(0, 100),
      match_kind: r.match_kind, match_value: r.match_value.trim().slice(0, 300),
      points: r.points, sort_order: i, is_active: r.is_active,
    })));
    if (insErr) return { ok: false, error: `ルールの保存に失敗: ${insErr.message}` };
  }

  // ---- 全件再スコア → ランク分布 ----
  let rescored = 0;
  try {
    const { data, error } = await sb.rpc("rescore_leads");
    if (error) return { ok: false, error: `保存はされましたが再スコアに失敗しました（条件パターンを確認してください）: ${error.message}` };
    rescored = (data as number) ?? 0;
  } catch (e) {
    return { ok: false, error: `保存はされましたが再スコアに失敗しました: ${String(e)}` };
  }
  const distribution: Record<string, number> = {};
  for (const rank of ["S", "A", "B", "C", "D"]) {
    const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).eq("rank", rank);
    distribution[rank] = count ?? 0;
  }

  await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "scoring.save", target: "lead_scoring_rules", meta: { rules: rules.length, rescored }, ip: clientIp() });
  revalidatePath("/app/leads");
  revalidatePath("/app/leads/scoring");
  return { ok: true, rescored, distribution };
}
