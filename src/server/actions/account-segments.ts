"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { DEFAULT_RANK_SETTINGS, type RankSettings } from "@/lib/account-matrix";

/**
 * 顧客セグメント(業界分類)マスタの編集。
 * 表示/非表示・並び順・名称・色・自動マッピング用キーワードを扱う。
 * 書き込み可否は RLS の can_edit_role(tenant_id) が一次防御。ここは入力検証のみ。
 */

type Result = { ok: boolean; error?: string };

const MATRIX_PATH = "/app/accounts/matrix";

export interface SegmentInput {
  id: string | null;
  name: string;
  color: string | null;
  /** カンマ・読点・空白区切りの文字列。industry への部分一致に使う */
  keywords: string;
}

/** キーワード入力を配列へ正規化(全角読点・カンマ・改行・空白のいずれでも区切れる)。 */
function parseKeywords(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,、\n\r\t]+|\s{1,}/)
        .map((k) => k.trim())
        .filter(Boolean)
    )
  ).slice(0, 40);
}

/** セグメントを新規作成 or 更新。 */
export async function saveSegmentAction(input: SegmentInput): Promise<Result> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "セグメント名を入力してください" };
  if (name.length > 40) return { ok: false, error: "セグメント名は40文字以内にしてください" };

  const color = input.color?.trim() || null;
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: "色は #RRGGBB 形式で指定してください" };

  const patch = { name, color, keywords: parseKeywords(input.keywords) };

  if (input.id) {
    const { error } = await sb.from("account_segments").update(patch).eq("id", input.id);
    if (error) return { ok: false, error: uniqueMessage(error.message) };
  } else {
    // 末尾に追加する(既存の最大 sort_order + 10)
    const { data: last } = await sb
      .from("account_segments")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 10;
    const { error } = await sb
      .from("account_segments")
      .insert({ ...patch, sort_order: sortOrder, tenant_id: ctx.tenantId });
    if (error) return { ok: false, error: uniqueMessage(error.message) };
  }

  revalidatePath(MATRIX_PATH);
  return { ok: true };
}

/** 表示/非表示を切り替える。非表示にしてもデータ(所属顧客)は消えない。 */
export async function setSegmentVisibleAction(input: { id: string; isVisible: boolean }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("account_segments").update({ is_visible: input.isVisible }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(MATRIX_PATH);
  return { ok: true };
}

/**
 * 並び順を一括保存する。
 * 画面から受け取った ID 配列の順に 10, 20, 30... を振り直す。
 * 1行ずつの更新なのは、順序変更が高々数十件で、かつ RLS を素直に効かせたいため。
 */
export async function reorderSegmentsAction(input: { ids: string[] }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  if (input.ids.length === 0) return { ok: true };
  if (input.ids.length > 200) return { ok: false, error: "セグメントが多すぎます" };

  const results = await Promise.all(
    input.ids.map((id, i) => sb.from("account_segments").update({ sort_order: (i + 1) * 10 }).eq("id", id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidatePath(MATRIX_PATH);
  return { ok: true };
}

/**
 * セグメントを削除する。
 * accounts.segment_id は on delete set null なので、手動割当していた顧客は未分類に戻る。
 */
export async function deleteSegmentAction(input: { id: string }): Promise<Result> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("account_segments").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(MATRIX_PATH);
  return { ok: true };
}

/** ランク自動判定の閾値を保存する。 */
export async function saveRankSettingsAction(input: RankSettings): Promise<Result> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  const num = (v: number, fallback: number) => (Number.isFinite(v) && v >= 0 ? v : fallback);
  const patch = {
    tenant_id: ctx.tenantId,
    s_revenue: num(input.s_revenue, DEFAULT_RANK_SETTINGS.s_revenue),
    a_revenue: num(input.a_revenue, DEFAULT_RANK_SETTINGS.a_revenue),
    a_potential: num(input.a_potential, DEFAULT_RANK_SETTINGS.a_potential),
    b_potential: num(input.b_potential, DEFAULT_RANK_SETTINGS.b_potential),
    s_employees: Math.round(num(input.s_employees, DEFAULT_RANK_SETTINGS.s_employees)),
    a_employees: Math.round(num(input.a_employees, DEFAULT_RANK_SETTINGS.a_employees)),
  };
  if (patch.s_revenue < patch.a_revenue) return { ok: false, error: "Sランクの受注額はAランク以上にしてください" };
  if (patch.s_employees < patch.a_employees) return { ok: false, error: "Sランクの従業員数はAランク以上にしてください" };

  const { error } = await sb.from("account_rank_settings").upsert(patch, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath(MATRIX_PATH);
  return { ok: true };
}

function uniqueMessage(message: string): string {
  return message.includes("idx_account_segments_name") ? "同じ名前のセグメントが既にあります" : message;
}
