"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseXrayPayload, type XrayData } from "@/lib/xray";

/** 営業レントゲンのメトリクス取得。期間・比較期間はユーザーが自由に指定(end排他的)。 */
export async function fetchXrayAction(input: {
  start: string;
  end: string;
  cmpStart: string;
  cmpEnd: string;
}): Promise<XrayData | null> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("xray_metrics", {
    p_start: input.start,
    p_end: input.end,
    p_cmp_start: input.cmpStart,
    p_cmp_end: input.cmpEnd,
  });
  if (error) return null;
  return parseXrayPayload(data);
}

/** 現在の分析条件でスナップショットを保存(サーバ側で再計算して保存するためクライアント改ざん不可)。 */
export async function saveXraySnapshotAction(input: {
  start: string;
  end: string;
  cmpStart: string;
  cmpEnd: string;
  label: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("xray_metrics", {
    p_start: input.start,
    p_end: input.end,
    p_cmp_start: input.cmpStart,
    p_cmp_end: input.cmpEnd,
  });
  if (error || !data || !(data as Record<string, unknown>).cur) {
    return { ok: false, error: "分析データの取得に失敗しました" };
  }
  const { data: row, error: insErr } = await sb
    .from("xray_snapshots")
    .insert({
      tenant_id: ctx.tenantId,
      kind: "manual",
      label: input.label?.trim() || null,
      period_start: input.start,
      period_end: input.end,
      cmp_start: input.cmpStart,
      cmp_end: input.cmpEnd,
      payload: data,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (insErr || !row) return { ok: false, error: "保存に失敗しました: " + (insErr?.message ?? "") };
  return { ok: true, id: row.id as string };
}

export interface XraySnapshotListItem {
  id: string;
  kind: "manual" | "monthly";
  label: string | null;
  taken_at: string;
  period_start: string;
  period_end: string;
  revenue_booked: number;
  won_booked: number;
  leads: number;
  created_by_name: string | null;
}

/** スナップショット履歴一覧(新しい順・要約数値付き)。payload全体は取得しない(軽量)。 */
export async function listXraySnapshotsAction(): Promise<XraySnapshotListItem[]> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("xray_snapshots")
    .select("id, kind, label, taken_at, period_start, period_end, created_by, revenue_booked:payload->cur->revenue_booked, won_booked:payload->cur->won_booked, leads:payload->cur->leads")
    .order("taken_at", { ascending: false })
    .limit(200);
  if (!data?.length) return [];
  const userIds = Array.from(new Set(data.map((r) => r.created_by).filter(Boolean))) as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await sb.from("profiles").select("id, display_name, email").in("id", userIds);
    for (const p of profs ?? []) names.set(p.id as string, (p.display_name as string) ?? (p.email as string) ?? "—");
  }
  return data.map((r) => ({
    id: r.id as string,
    kind: r.kind as "manual" | "monthly",
    label: (r.label as string) ?? null,
    taken_at: r.taken_at as string,
    period_start: r.period_start as string,
    period_end: r.period_end as string,
    revenue_booked: Number(r.revenue_booked ?? 0),
    won_booked: Number(r.won_booked ?? 0),
    leads: Number(r.leads ?? 0),
    created_by_name: r.created_by ? (names.get(r.created_by as string) ?? "—") : null,
  }));
}

/** スナップショット削除(RLS: 作成者本人 or オーナー/管理者)。 */
export async function deleteXraySnapshotAction(input: { id: string }): Promise<{ ok: boolean }> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { error } = await sb.from("xray_snapshots").delete().eq("id", input.id);
  return { ok: !error };
}
